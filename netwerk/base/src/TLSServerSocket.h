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

class TLSServerSocket : public nsASocketHandler
                      , public nsITLSServerSocket
{
public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSISERVERSOCKET
  NS_DECL_NSITLSSERVERSOCKET

  // nsASocketHandler methods:
  virtual void OnSocketReady(PRFileDesc *fd, int16_t outFlags);
  virtual void OnSocketDetached(PRFileDesc *fd);
  virtual void IsLocal(bool *aIsLocal);
  virtual void KeepWhenOffline(bool *aKeepWhenOffline);

  virtual uint64_t ByteCountSent() { return 0; }
  virtual uint64_t ByteCountReceived() { return 0; }
  TLSServerSocket();

  virtual ~TLSServerSocket();

private:
  void OnMsgClose();
  void OnMsgAttach();

  // try attaching our socket (mFD) to the STS's poll list.
  nsresult TryAttach();

  static SECStatus AuthCertificateHook(void *arg, PRFileDesc *fd,
                                       PRBool checksig, PRBool isServer);

  // lock protects access to mListener; so it is not cleared while being used.
  mozilla::Mutex                    mLock;
  PRFileDesc                       *mFD;
  PRNetAddr                         mAddr;
  nsCOMPtr<nsIServerSocketListener> mListener;
  nsCOMPtr<nsIEventTarget>          mListenerTarget;
  bool                              mAttached;
  bool                              mKeepWhenOffline;
  nsCOMPtr<nsIX509Cert>             mServerCert;
};

} // namespace net
} // namespace mozilla

#endif // mozilla_net_TLSServerSocket_h
