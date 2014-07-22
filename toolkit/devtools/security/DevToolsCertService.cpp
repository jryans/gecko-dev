/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "DevToolsCertService.h"

#include "mozilla/ModuleUtils.h"
#include "nsIX509Cert.h"
#include "nsIX509CertDB.h"
#include "nsLiteralString.h"
#include "nsServiceManagerUtils.h"

namespace mozilla {

NS_IMPL_ISUPPORTS(DevToolsCertService, nsIDevToolsCertService)

DevToolsCertService::DevToolsCertService()
  : mCert(nullptr)
{
}

DevToolsCertService::~DevToolsCertService()
{
}

NS_IMETHODIMP
DevToolsCertService::GetOrCreateCert(nsIX509Cert** aCert)
{
  if (mCert) {
    *aCert = mCert;
    NS_IF_ADDREF(*aCert);
    return NS_OK;
  }

  // Try to lookup an existing cert in the DB
  // TODO: Set to devtools
  NS_NAMED_LITERAL_STRING(certName, "jryans");

  nsCOMPtr<nsIX509CertDB> certDB = do_GetService(NS_X509CERTDB_CONTRACTID);
  if (!certDB) {
    return NS_ERROR_FAILURE;
  }

  nsCOMPtr<nsIX509Cert> cert;
  nsresult rv;
  rv = certDB->FindCertByNickname(nullptr, certName,
                                  getter_AddRefs(cert));
  if (NS_SUCCEEDED(rv)) {
    // TODO: Verify cert is good
    mCert = cert;
    *aCert = mCert;
    NS_IF_ADDREF(*aCert);
    return NS_OK;
  }

  // Generate a new cert


  return NS_ERROR_NOT_IMPLEMENTED;
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
