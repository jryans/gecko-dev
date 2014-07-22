/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "DevToolsCertService.h"

namespace mozilla {

NS_IMPL_ISUPPORTS(DevToolsCertService, nsIDevToolsCertService)

DevToolsCertService::DevToolsCertService()
{
  /* member initializers and constructor code */
}

DevToolsCertService::~DevToolsCertService()
{
  /* destructor code */
}

NS_IMETHODIMP
DevToolsCertService::GetOrCreateCert(nsIX509Cert** aCert)
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

} // namespace mozilla
