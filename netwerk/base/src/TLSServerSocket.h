/* vim:set ts=2 sw=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_net_TLSServerSocket_h
#define mozilla_net_TLSServerSocket_h

#include "nsAutoPtr.h"
#include "nsITLSServerSocket.h"
#include "nsServerSocket.h"
#include "mozilla/Mutex.h"
#include "seccomon.h"

namespace mozilla {
namespace net {

class TLSServerSocket : public nsServerSocket
                      , public nsITLSServerSocket
{
public:
  NS_DECL_ISUPPORTS_INHERITED
  NS_FORWARD_NSISERVERSOCKET(nsServerSocket::)
  NS_DECL_NSITLSSERVERSOCKET

  // Override methods from nsServerSocket
  virtual void CreateClientTransport(PRFileDesc* clientFD,
                                     const NetAddr& clientAddr) MOZ_OVERRIDE;
  virtual nsresult SetSocketDefaults() MOZ_OVERRIDE;
  virtual nsresult OnSocketListen() MOZ_OVERRIDE;

  void OnHandshakeDone(nsITLSServerConnectionInfo* aInfo);

  TLSServerSocket();

private:
  virtual ~TLSServerSocket();

  static SECStatus AuthCertificateHook(void* arg, PRFileDesc* fd,
                                       PRBool checksig, PRBool isServer);
  static void HandshakeCallback(PRFileDesc* fd, void* arg);

  nsCOMPtr<nsIX509Cert>             mServerCert;
};

class TLSServerConnectionInfo : public nsITLSServerConnectionInfo
                              , public nsITLSClientStatus
{
  friend class TLSServerSocket;
  friend class TLSServerOutputNudger;

public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSITLSSERVERCONNECTIONINFO
  NS_DECL_NSITLSCLIENTSTATUS

  TLSServerConnectionInfo();

private:
  virtual ~TLSServerConnectionInfo();

  nsRefPtr<TLSServerSocket>    mServerSocket;
  nsCOMPtr<nsISocketTransport> mTransport;
  PRFileDesc*                  mClientFD;
  nsCOMPtr<nsIX509Cert>        mPeerCert;
  int16_t                      mTlsVersionUsed;
  nsCString                    mCipherName;
  uint32_t                     mKeyLength;
  uint32_t                     mMacLength;
};

} // namespace net
} // namespace mozilla

#endif // mozilla_net_TLSServerSocket_h
