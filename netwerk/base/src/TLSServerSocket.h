/* vim:set ts=2 sw=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_net_TLSServerSocket_h
#define mozilla_net_TLSServerSocket_h

#include "nsASocketHandler.h"
#include "nsITLSServerSocket.h"
#include "mozilla/Mutex.h"
#include "seccomon.h"

namespace mozilla {
namespace net {

#define TLSSERVERSOCKET_IMPL_IID \
{ 0x8127169b, 0x55a3, 0x4c20, \
  { 0xbc, 0xfc, 0xc1, 0xeb, 0x69, 0xb2, 0x88, 0x72 } }

class TLSServerSocket : public nsASocketHandler
                      , public nsITLSServerSocket
{
public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSISERVERSOCKET
  NS_DECL_NSITLSSERVERSOCKET
  NS_DECLARE_STATIC_IID_ACCESSOR(TLSSERVERSOCKET_IMPL_IID)

  // nsASocketHandler methods:
  virtual void OnSocketReady(PRFileDesc *fd, int16_t outFlags);
  virtual void OnSocketDetached(PRFileDesc *fd);
  virtual void IsLocal(bool *aIsLocal);
  virtual void KeepWhenOffline(bool *aKeepWhenOffline);

  virtual uint64_t ByteCountSent() { return 0; }
  virtual uint64_t ByteCountReceived() { return 0; }

  void OnHandshakeDone(nsITLSServerConnectionInfo* aInfo);

  TLSServerSocket();

private:
  virtual ~TLSServerSocket();

  void OnMsgClose();
  void OnMsgAttach();

  // try attaching our socket (mFD) to the STS's poll list.
  nsresult TryAttach();

  static SECStatus AuthCertificateHook(void *arg, PRFileDesc *fd,
                                       PRBool checksig, PRBool isServer);
  static void HandshakeCallback(PRFileDesc *fd, void* arg);

  // mLock protects access to mListener / mSecurityCallback, so it is not
  // cleared while being used
  mozilla::Mutex                    mLock;
  PRFileDesc                       *mFD;
  PRNetAddr                         mAddr;
  nsCOMPtr<nsIServerSocketListener> mListener;
  nsCOMPtr<nsIEventTarget>          mListenerTarget;
  bool                              mAttached;
  bool                              mKeepWhenOffline;
  nsCOMPtr<nsIX509Cert>             mServerCert;
};

NS_DEFINE_STATIC_IID_ACCESSOR(TLSServerSocket, TLSSERVERSOCKET_IMPL_IID)

class TLSServerConnectionInfo : public nsITLSServerConnectionInfo
{
  friend class TLSServerSocket;
  friend class TLSServerOutputNudger;

public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSITLSSERVERCONNECTIONINFO

  TLSServerConnectionInfo();

private:
  virtual ~TLSServerConnectionInfo();

  nsCOMPtr<nsITLSServerSocket> mServerSocket;
  nsCOMPtr<nsISocketTransport> mTransport;
  PRFileDesc*                  mClientFD;
  nsCOMPtr<nsISSLStatus>       mTlsStatus;
};

} // namespace net
} // namespace mozilla

#endif // mozilla_net_TLSServerSocket_h
