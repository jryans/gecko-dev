/* vim:set ts=2 sw=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "TLSServerSocket.h"

#include "mozilla/net/DNS.h"
#include "mozilla/RefPtr.h"
#include "nsAutoPtr.h"
#include "nsComponentManagerUtils.h"
#include "nsIServerSocket.h"
#include "nsITimer.h"
#include "nsIX509Cert.h"
#include "nsIX509CertDB.h"
#include "nsNetCID.h"
#include "nsServiceManagerUtils.h"
#include "nsSocketTransport2.h"
#include "ScopedNSSTypes.h"
#include "ssl.h"

extern PRThread *gSocketThread;

namespace mozilla {
namespace net {

static NS_DEFINE_CID(kSocketTransportServiceCID, NS_SOCKETTRANSPORTSERVICE_CID);

//-----------------------------------------------------------------------------

/**
 * We need to nudge the TLS handshake machinery along when a new client
 * connects.  We can do this by "writing" 0 bytes.  In order for it to advance
 * successfully, we must have already received the client's handshake packet.
 * However, we don't know when that will arrive.  It particular, it is quite
 * likely / always the case that this data is not yet here at the time we
 * |PR_Accept| the client socket.  So, a timer is used to keep trying until we
 * make progress.
 */
class TLSServerOutputNudger : public nsITimerCallback
{
  NS_DECL_THREADSAFE_ISUPPORTS

  TLSServerOutputNudger(TLSServerConnectionInfo* aConnectionInfo)
    : mConnectionInfo(aConnectionInfo)
    , mTimer(nullptr)
    , mCounter(0)
  {
  }

  nsresult Nudge()
  {
    nsresult rv;

    if (!mTimer) {
      mTimer = do_CreateInstance("@mozilla.org/timer;1", &rv);
      if (NS_FAILED(rv)) {
        return rv;
      }
    }

    uint32_t counter = mCounter++;
    uint32_t delay;

    // Borrowed this backoff schedule from http/TunnelUtils.cpp, as it solves a
    // similar TLS state machine timing problem.
    if (!counter) {
      delay = 0;
    } else if (counter < 8) { // up to 48ms at 6ms
      delay = 6;
    } else if (counter < 34) { // up to 499ms at 17ms
      delay = 17;
    } else { // after that at 51ms
      delay = 51;
    }

    rv = mTimer->InitWithCallback(this, delay, nsITimer::TYPE_ONE_SHOT);
    if (NS_FAILED(rv)) {
      return rv;
    }

    return NS_OK;
  }

  NS_IMETHODIMP Notify(nsITimer* aTimer)
  {
    MOZ_ASSERT(PR_GetCurrentThread() == gSocketThread);
    // Attempt an empty write to nudge the TLS state machine
    PR_Write(mConnectionInfo->mClientFD, "", 0);
    PRErrorCode result = PR_GetError();
    SOCKET_LOG(("TLSServerNudge %p %d %d\n", this, result,
                result == PR_WOULD_BLOCK_ERROR));

    if (result == PR_WOULD_BLOCK_ERROR) {
      // Still blocked, so try again later
      Nudge();
    } else {
      // Not blocked, reset the counter
      mCounter = 0;
    }

    return NS_OK;
  }

private:
  virtual ~TLSServerOutputNudger() {}
  RefPtr<TLSServerConnectionInfo> mConnectionInfo;
  nsCOMPtr<nsITimer>              mTimer;
  uint32_t                        mCounter;
};

NS_IMPL_ISUPPORTS(TLSServerOutputNudger, nsITimerCallback)

//-----------------------------------------------------------------------------
// TLSServerSocket
//-----------------------------------------------------------------------------

TLSServerSocket::TLSServerSocket()
  : mServerCert(nullptr)
{
}

TLSServerSocket::~TLSServerSocket()
{
}

NS_IMPL_ISUPPORTS_INHERITED(TLSServerSocket,
                            nsServerSocket,
                            nsITLSServerSocket)

nsresult
TLSServerSocket::SetSocketDefaults()
{
  // Set TLS options on the listening socket
  mFD = SSL_ImportFD(nullptr, mFD);
  if (NS_WARN_IF(!mFD)) {
    return mozilla::psm::GetXPCOMFromNSSError(PR_GetError());
  }

  SSL_OptionSet(mFD, SSL_SECURITY, true);
  SSL_OptionSet(mFD, SSL_HANDSHAKE_AS_CLIENT, false);
  SSL_OptionSet(mFD, SSL_HANDSHAKE_AS_SERVER, true);

  // We don't currently notify the server API consumer of renegotiation events
  // (to revalidate peer certs, etc.), so disable it for now.
  SSL_OptionSet(mFD, SSL_ENABLE_RENEGOTIATION, SSL_RENEGOTIATE_NEVER);

  SetSessionCache(true);
  SetSessionTickets(true);
  SetRequestCertificate(REQUEST_NEVER);

  return NS_OK;
}

void
TLSServerSocket::CreateClientTransport(PRFileDesc* aClientFD,
                                       const NetAddr& aClientAddr)
{
  MOZ_ASSERT(PR_GetCurrentThread() == gSocketThread);
  nsresult rv;

  nsRefPtr<nsSocketTransport> trans = new nsSocketTransport;
  if (NS_WARN_IF(!trans)) {
    mCondition = NS_ERROR_OUT_OF_MEMORY;
    return;
  }

  RefPtr<TLSServerConnectionInfo> info = new TLSServerConnectionInfo();
  info->mServerSocket = this;
  info->mTransport = trans;
  info->mClientFD = aClientFD;
  nsCOMPtr<nsISupports> infoSupports =
    NS_ISUPPORTS_CAST(nsITLSServerConnectionInfo*, info);
  rv = trans->InitWithConnectedSocket(aClientFD, &aClientAddr, infoSupports);
  if (NS_WARN_IF(NS_FAILED(rv))) {
    mCondition = rv;
    return;
  }

  // Override the default peer certificate validation, so that server consumers
  // can make their own choice when notified of the new client.
  SSL_AuthCertificateHook(aClientFD, AuthCertificateHook, nullptr);
  // Once the TLS handshake has completed, the server consumer is notified of
  // new client and has access to various TLS state details.
  SSL_HandshakeCallback(aClientFD, HandshakeCallback, info);

  // Move the TLS state machine along
  auto nudger = new TLSServerOutputNudger(info);
  nudger->Nudge();
}

nsresult
TLSServerSocket::OnSocketListen()
{
  if (NS_WARN_IF(!mServerCert)) {
    return NS_ERROR_NOT_INITIALIZED;
  }

  ScopedCERTCertificate cert(mServerCert->GetCert());
  if (NS_WARN_IF(!cert)) {
    return mozilla::psm::GetXPCOMFromNSSError(PR_GetError());
  }

  ScopedSECKEYPrivateKey key(PK11_FindKeyByAnyCert(cert, nullptr));
  if (NS_WARN_IF(!key)) {
    return mozilla::psm::GetXPCOMFromNSSError(PR_GetError());
  }

  SSLKEAType certKEA = NSS_FindCertKEAType(cert);

  nsresult rv = MapSECStatus(SSL_ConfigSecureServer(mFD, cert, key, certKEA));
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return rv;
  }

  return NS_OK;
}

SECStatus
TLSServerSocket::AuthCertificateHook(void* arg, PRFileDesc* fd, PRBool checksig,
                                     PRBool isServer)
{
  // Allow any client cert here, server consumer code can decide whether it's
  // okay after being notified of the new client socket.
  return SECSuccess;
}

void
TLSServerSocket::HandshakeCallback(PRFileDesc* fd, void* arg)
{
  nsresult rv;
  RefPtr<TLSServerConnectionInfo> info =
    static_cast<TLSServerConnectionInfo*>(arg);

  ScopedCERTCertificate clientCert(SSL_PeerCertificate(fd));
  if (clientCert) {
    nsCOMPtr<nsIX509CertDB> certDB =
      do_GetService(NS_X509CERTDB_CONTRACTID, &rv);
    if (NS_WARN_IF(NS_FAILED(rv))) {
      info->mTransport->Close(rv);
      return;
    }

    nsCOMPtr<nsIX509Cert> nsClientCert;
    rv = certDB->ConstructX509(reinterpret_cast<char*>(clientCert->derCert.data),
                               clientCert->derCert.len,
                               getter_AddRefs(nsClientCert));
    if (NS_WARN_IF(NS_FAILED(rv))) {
      info->mTransport->Close(rv);
      return;
    }

    info->mPeerCert = nsClientCert;
  }

  SSLChannelInfo channelInfo;
  rv = MapSECStatus(SSL_GetChannelInfo(fd, &channelInfo, sizeof(channelInfo)));
  if (NS_WARN_IF(NS_FAILED(rv))) {
    info->mTransport->Close(rv);
    return;
  }
  info->mTlsVersionUsed = channelInfo.protocolVersion;

  SSLCipherSuiteInfo cipherInfo;
  rv = MapSECStatus(SSL_GetCipherSuiteInfo(channelInfo.cipherSuite, &cipherInfo,
                                           sizeof(cipherInfo)));
  if (NS_WARN_IF(NS_FAILED(rv))) {
    info->mTransport->Close(rv);
    return;
  }
  info->mCipherName.Assign(cipherInfo.cipherSuiteName);
  info->mKeyLength = cipherInfo.effectiveKeyBits;
  info->mMacLength = cipherInfo.macBits;

  nsRefPtr<TLSServerSocket> serverSocket = info->mServerSocket;
  serverSocket->OnHandshakeDone(info);
}

void
TLSServerSocket::OnHandshakeDone(nsITLSServerConnectionInfo* aInfo)
{
  // Notify consumer code of new client now that handshake is complete
  if (mListener) {
    nsCOMPtr<nsISocketTransport> transport;
    aInfo->GetTransport(getter_AddRefs(transport));
    nsCOMPtr<nsIServerSocket> serverSocket =
      do_QueryInterface(NS_ISUPPORTS_CAST(nsITLSServerSocket*, this));
    mListener->OnSocketAccepted(serverSocket, transport);
  }
}

//-----------------------------------------------------------------------------
// TLSServerSocket::nsITLSServerSocket
//-----------------------------------------------------------------------------

NS_IMETHODIMP
TLSServerSocket::GetServerCert(nsIX509Cert** aCert)
{
  if (NS_WARN_IF(!aCert)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aCert = mServerCert;
  NS_IF_ADDREF(*aCert);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerSocket::SetServerCert(nsIX509Cert* aCert)
{
  mServerCert = aCert;
  return NS_OK;
}

NS_IMETHODIMP
TLSServerSocket::GetSessionCache(bool* aEnabled)
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
TLSServerSocket::SetSessionCache(bool aEnabled)
{
  SSL_OptionSet(mFD, SSL_NO_CACHE, !aEnabled);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerSocket::GetSessionTickets(bool* aEnabled)
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
TLSServerSocket::SetSessionTickets(bool aEnabled)
{
  SSL_OptionSet(mFD, SSL_ENABLE_SESSION_TICKETS, aEnabled);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerSocket::GetRequestCertificate(uint32_t* aMode)
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
TLSServerSocket::SetRequestCertificate(uint32_t aMode)
{
  SSL_OptionSet(mFD, SSL_REQUEST_CERTIFICATE, aMode != REQUEST_NEVER);

  switch (aMode) {
    case REQUEST_ALWAYS:
      SSL_OptionSet(mFD, SSL_REQUIRE_CERTIFICATE, SSL_REQUIRE_NO_ERROR);
      break;
    case REQUIRE_FIRST_HANDSHAKE:
      SSL_OptionSet(mFD, SSL_REQUIRE_CERTIFICATE, SSL_REQUIRE_FIRST_HANDSHAKE);
      break;
    case REQUIRE_ALWAYS:
      SSL_OptionSet(mFD, SSL_REQUIRE_CERTIFICATE, SSL_REQUIRE_ALWAYS);
      break;
    default:
      SSL_OptionSet(mFD, SSL_REQUIRE_CERTIFICATE, SSL_REQUIRE_NEVER);
  }
  return NS_OK;
}

//-----------------------------------------------------------------------------
// TLSServerConnectionInfo
//-----------------------------------------------------------------------------

NS_IMPL_ISUPPORTS(TLSServerConnectionInfo,
                  nsITLSServerConnectionInfo,
                  nsITLSClientStatus)

TLSServerConnectionInfo::TLSServerConnectionInfo()
  : mServerSocket(nullptr)
  , mTransport(nullptr)
  , mClientFD(nullptr)
  , mPeerCert(nullptr)
  , mTlsVersionUsed(TLS_VERSION_UNKNOWN)
  , mKeyLength(0)
  , mMacLength(0)
{
}

TLSServerConnectionInfo::~TLSServerConnectionInfo()
{
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetServerSocket(nsITLSServerSocket** aSocket)
{
  if (NS_WARN_IF(!aSocket)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aSocket = mServerSocket;
  NS_IF_ADDREF(*aSocket);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetTransport(nsISocketTransport** aTransport)
{
  if (NS_WARN_IF(!aTransport)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aTransport = mTransport;
  NS_IF_ADDREF(*aTransport);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetStatus(nsITLSClientStatus** aStatus)
{
  if (NS_WARN_IF(!aStatus)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aStatus = this;
  NS_IF_ADDREF(*aStatus);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetPeerCert(nsIX509Cert** aCert)
{
  if (NS_WARN_IF(!aCert)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aCert = mPeerCert;
  NS_IF_ADDREF(*aCert);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetTlsVersionUsed(int16_t* aTlsVersionUsed)
{
  if (NS_WARN_IF(!aTlsVersionUsed)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aTlsVersionUsed = mTlsVersionUsed;
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetCipherName(nsACString& aCipherName)
{
  aCipherName.Assign(mCipherName);
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetKeyLength(uint32_t* aKeyLength)
{
  if (NS_WARN_IF(!aKeyLength)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aKeyLength = mKeyLength;
  return NS_OK;
}

NS_IMETHODIMP
TLSServerConnectionInfo::GetMacLength(uint32_t* aMacLength)
{
  if (NS_WARN_IF(!aMacLength)) {
    return NS_ERROR_INVALID_POINTER;
  }
  *aMacLength = mMacLength;
  return NS_OK;
}

} // namespace net
} // namespace mozilla
