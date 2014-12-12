/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Services = require("Services");
let DevToolsUtils = require("devtools/toolkit/DevToolsUtils");
loader.lazyRequireGetter(this, "DebuggerSocket",
  "devtools/toolkit/security/socket", true);

DevToolsUtils.defineLazyGetter(this, "bundle", () => {
  const DBG_STRINGS_URI = "chrome://global/locale/devtools/debugger.properties";
  return Services.strings.createBundle(DBG_STRINGS_URI);
});

let Server = exports.Server = {};

/**
 * Prompt the user to accept or decline the incoming connection. This is the
 * default implementation that products embedding the debugger server may
 * choose to override.  A separate security handler can be specified for each
 * socket via |allowConnection| on a socket listener instance.
 *
 * @return Either an AuthenticationResult value, or an object containing:
 *         * result: One of the AuthenticationResult values
 *         * ...:    Any other data needed by the authentication mode
 *         A promise that will be resolved to the above is also allowed.
 */
Server.defaultAllowConnection = ({ client, server }) => {
  const key = "remoteIncomingPrompt";
  let title = bundle.GetStringFromName(key + "Title");
  let header = bundle.GetStringFromName(key + "Header");
  let clientAddress = `${client.host}:${client.port}`;
  let clientMsg = bundle.formatStringFromName(key + "ClientAddress",
                                              [clientAddress], 1);
  let serverAddress = `${server.host}:${server.port}`;
  let serverMsg = bundle.formatStringFromName(key + "ServerAddress",
                                              [serverAddress], 1);
  let footer = bundle.GetStringFromName(key + "Footer");
  let msg =`${header}\n\n${clientMsg}\n${serverMsg}\n\n${footer}`;
  let disableButton = bundle.GetStringFromName(key + "Disable");
  let prompt = Services.prompt;
  let flags = prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_OK +
              prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_CANCEL +
              prompt.BUTTON_POS_2 * prompt.BUTTON_TITLE_IS_STRING +
              prompt.BUTTON_POS_1_DEFAULT;
  let result = prompt.confirmEx(null, title, msg, flags, null, null,
                                disableButton, null, { value: false });
  if (result === 0) {
    return DebuggerSocket.AuthenticationResult.ALLOW;
  }
  if (result === 2) {
    return DebuggerSocket.AuthenticationResult.DISABLE_ALL;
  }
  return DebuggerSocket.AuthenticationResult.DENY;
};
