/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Register about:devtools-toolbox which allows to open a devtools toolbox
// in a Firefox tab or a custom html iframe in browser.html

const { interfaces: Ci, utils: Cu } = Components;
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
const { XPCOMUtils } = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
const { nsIAboutModule } = Ci;

function AboutURL() {}

AboutURL.prototype = {
  uri: Services.io.newURI("chrome://devtools/content/framework/toolbox.xul",
                          null, null),
  classDescription: "about:devtools-toolbox",
  classID: Components.ID("11342911-3135-45a8-8d71-737a2b0ad469"),
  contractID: "@mozilla.org/network/protocol/about;1?what=devtools-toolbox",

  QueryInterface: XPCOMUtils.generateQI([nsIAboutModule]),

  newChannel: function(uri, loadInfo) {
    let chan = Services.io.newChannelFromURIWithLoadInfo(this.uri, loadInfo);
    chan.owner = Services.scriptSecurityManager.getSystemPrincipal();
    return chan;
  },

  getURIFlags: function(uri) {
    return nsIAboutModule.ALLOW_SCRIPT |
           nsIAboutModule.ENABLE_INDEXED_DB |
           nsIAboutModule.URI_CAN_LOAD_IN_CHILD |
           nsIAboutModule.URI_MUST_LOAD_IN_CHILD;
  }
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([AboutURL]);
