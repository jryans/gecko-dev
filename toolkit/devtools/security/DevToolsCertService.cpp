/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "DevToolsCertService.h"

#include "mozilla/ModuleUtils.h"
#include "mozilla/RefPtr.h"
#include "cert.h"
#include "CryptoTask.h"
#include "nsIX509Cert.h"
#include "nsIX509CertDB.h"
#include "nsLiteralString.h"
#include "nsProxyRelease.h"
#include "nsServiceManagerUtils.h"
#include "pk11pub.h"
#include "ScopedNSSTypes.h"

namespace mozilla {

class DevToolsGetCertTask : public CryptoTask
{
public:
  DevToolsGetCertTask(nsIDevToolsGetCertCallback* aCallback)
    : mCallback(new nsMainThreadPtrHolder<nsIDevToolsGetCertCallback>(aCallback))
    , mCert(nullptr)
  {
  }

private:
  virtual nsresult CalculateResult() MOZ_OVERRIDE
  {
    // Try to lookup an existing cert in the DB
    NS_NAMED_LITERAL_CSTRING(certName, "devtools");

    nsCOMPtr<nsIX509CertDB> certDB = do_GetService(NS_X509CERTDB_CONTRACTID);
    if (!certDB) {
      return NS_ERROR_FAILURE;
    }

    nsCOMPtr<nsIX509Cert> certFromDB;
    nsresult rv;
    rv = certDB->FindCertByNickname(nullptr, NS_ConvertASCIItoUTF16(certName),
                                    getter_AddRefs(certFromDB));
    if (NS_SUCCEEDED(rv)) {
      // TODO: Verify cert is good
      mCert = certFromDB;
      return NS_OK;
    }

    // Generate a new cert
    NS_NAMED_LITERAL_CSTRING(subjectNameStr, "CN=devtools");
    ScopedCERTName subjectName(CERT_AsciiToName(subjectNameStr.get()));
    if (!subjectName) {
      return NS_ERROR_FAILURE;
    }

    // Use the well-known NIST P-265 curve
    SECOidData* curveOidData = SECOID_FindOIDByTag(SEC_OID_SECG_EC_SECP256R1);
    if (!curveOidData) {
      return NS_ERROR_FAILURE;
    }

    // Get key params from the curve
    ScopedAutoSECItem keyParams(2 + curveOidData->oid.len);
    keyParams.data[0] = SEC_ASN1_OBJECT_ID;
    keyParams.data[1] = curveOidData->oid.len;
    memcpy(keyParams.data + 2, curveOidData->oid.data, curveOidData->oid.len);

    // Generate cert key pair
    ScopedPK11SlotInfo slot(PK11_GetInternalKeySlot());
    if (!slot) {
      return NS_ERROR_FAILURE;
    }
    ScopedSECKEYPrivateKey privateKey;
    ScopedSECKEYPublicKey publicKey;
    SECKEYPublicKey* tempPublicKey;
    privateKey = PK11_GenerateKeyPair(slot, CKM_EC_KEY_PAIR_GEN, &keyParams,
                                      &tempPublicKey, PR_TRUE /* token */,
                                      PR_TRUE /* sensitive */, nullptr);
    if (!privateKey) {
      return NS_ERROR_FAILURE;
    }
    publicKey = tempPublicKey;

    // Create subject public key info and cert request
    ScopedCERTSubjectPublicKeyInfo spki(
      SECKEY_CreateSubjectPublicKeyInfo(publicKey));
    if (!spki) {
      return NS_ERROR_FAILURE;
    }
    ScopedCERTCertificateRequest certRequest(
      CERT_CreateCertificateRequest(subjectName, spki, nullptr));
    if (!certRequest) {
      return NS_ERROR_FAILURE;
    }

    // Valid from one day before to 2 years after
    static const PRTime oneDay = PRTime(PR_USEC_PER_SEC)
                               * PRTime(60)  // sec
                               * PRTime(60)  // min
                               * PRTime(24); // hours

    PRTime now = PR_Now();
    PRTime notBefore = now - oneDay;
    PRTime notAfter = now + (PRTime(365) * PRTime(2) * oneDay);
    ScopedCERTValidity validity(CERT_CreateValidity(notBefore, notAfter));
    if (!validity) {
      return NS_ERROR_FAILURE;
    }

    // Generate random serial
    unsigned long serial;
    // Note: This serial in principle could collide, but it's unlikely
    SECStatus srv =
      PK11_GenerateRandomOnSlot(slot,
                                reinterpret_cast<unsigned char *>(&serial),
                                sizeof(serial));
    if (srv != SECSuccess) {
      return NS_ERROR_FAILURE;
    }

    // Create the cert from these pieces
    ScopedCERTCertificate cert(
      CERT_CreateCertificate(serial, subjectName, validity, certRequest));
    if (!cert) {
      return NS_ERROR_FAILURE;
    }

    // Update the cert version to X509v3
    *(cert->version.data) = SEC_CERTIFICATE_VERSION_3;
    cert->version.len = 1;

    // Set cert signature algorithm
    PLArenaPool* arena = cert->arena;
    srv = SECOID_SetAlgorithmID(arena, &cert->signature,
                                SEC_OID_ANSIX962_ECDSA_SHA256_SIGNATURE, 0);
    if (srv != SECSuccess) {
      return NS_ERROR_FAILURE;
    }

    // Encode and self-sign the cert
    ScopedSECItem certDER(
      SEC_ASN1EncodeItem(nullptr, nullptr, cert,
                         SEC_ASN1_GET(CERT_CertificateTemplate)));
    if (!certDER) {
      return NS_ERROR_FAILURE;
    }
    srv = SEC_DerSignData(arena, &cert->derCert, certDER->data, certDER->len,
                          privateKey, SEC_OID_ANSIX962_ECDSA_SHA256_SIGNATURE);
    if (srv != SECSuccess) {
      return NS_ERROR_FAILURE;
    }

    // Create a CERTCertificate from the signed data
    ScopedCERTCertificate certFromDER(
      CERT_NewTempCertificate(CERT_GetDefaultCertDB(), &cert->derCert, nullptr,
                              PR_TRUE /* perm */, PR_TRUE /* copyDER */));
    if (!certFromDER) {
      return NS_ERROR_FAILURE;
    }

    // Save the cert in the DB
    srv = PK11_ImportCert(slot, certFromDER, CK_INVALID_HANDLE,
                          certName.get(), PR_FALSE /* unused */);
    if (srv != SECSuccess) {
      return NS_ERROR_FAILURE;
    }

    // We should now have cert in the DB, read it back in nsIX509Cert form
    rv = certDB->FindCertByNickname(nullptr, NS_ConvertASCIItoUTF16(certName),
                                    getter_AddRefs(certFromDB));
    if (NS_FAILED(rv)) {
      return NS_ERROR_FAILURE;
    }

    // TODO: Verify cert is good
    mCert = certFromDB;
    return NS_OK;
  }

  virtual void ReleaseNSSResources() {}

  virtual void CallCallback(nsresult rv)
  {
    (void) mCallback->HandleCert(mCert, rv);
  }

  nsMainThreadPtrHandle<nsIDevToolsGetCertCallback> mCallback;
  nsCOMPtr<nsIX509Cert> mCert; // out
};

NS_IMPL_ISUPPORTS(DevToolsCertService, nsIDevToolsCertService)

DevToolsCertService::DevToolsCertService()
{
}

DevToolsCertService::~DevToolsCertService()
{
}

NS_IMETHODIMP
DevToolsCertService::GetOrCreateCert(nsIDevToolsGetCertCallback* aCallback)
{
  if (NS_WARN_IF(!aCallback)) {
    return NS_ERROR_INVALID_POINTER;
  }
  RefPtr<DevToolsGetCertTask> task(new DevToolsGetCertTask(aCallback));
  return task->Dispatch("DTGetCert");

}

#define DEVTOOLSCERTSERVICE_CID \
{ 0x47402be2, 0xe653, 0x45d0, \
  { 0x8d, 0xaa, 0x9f, 0x0d, 0xce, 0x0a, 0xc1, 0x48 } }

NS_GENERIC_FACTORY_CONSTRUCTOR(DevToolsCertService)

NS_DEFINE_NAMED_CID(DEVTOOLSCERTSERVICE_CID);

static const Module::CIDEntry kDevToolsCertServiceCIDs[] = {
  { &kDEVTOOLSCERTSERVICE_CID, false, nullptr, DevToolsCertServiceConstructor },
  { nullptr }
};

static const Module::ContractIDEntry kDevToolsCertServiceContracts[] = {
  { DEVTOOLSCERTSERVICE_CONTRACTID, &kDEVTOOLSCERTSERVICE_CID },
  { nullptr }
};

static const Module kDevToolsCertServiceModule = {
  Module::kVersion,
  kDevToolsCertServiceCIDs,
  kDevToolsCertServiceContracts
};

NSMODULE_DEFN(DevToolsCertServiceModule) = &kDevToolsCertServiceModule;

} // namespace mozilla
