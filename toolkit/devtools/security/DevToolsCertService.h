/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DevToolsCertService_h
#define DevToolsCertService_h

#include "nsIDevToolsCertService.h"

namespace mozilla {

class DevToolsCertService MOZ_FINAL : public nsIDevToolsCertService
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIDEVTOOLSCERTSERVICE

  DevToolsCertService();

private:
  ~DevToolsCertService();
};

} // namespace mozilla

#endif // DevToolsCertService_h
