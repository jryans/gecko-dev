/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict"

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function log(msg) {
  Services.console.logStringMessage(msg);
}

function TabSourceService() {
  log("TAB SOURCE SERVICE!");
  log("INTERFACE: " + Ci.nsITabSource);
}

TabSourceService.prototype = {

  classID: Components.ID("{5ddf052c-485e-46bd-9931-5d9cc89caf3b}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsITabSource]),

  getTabToStream: function() {
    Services.console.logStringMessage("in getTabToStream");
    let browser = Services.wm.getMostRecentWindow("navigator:browser");
    return browser;
    Services.console.logStringMessage("about to return contentWindow");
    return browser.getContentWindow();
  }

};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([TabSourceService]);
