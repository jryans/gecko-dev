/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Ci, Cu, Cr } = require("chrome");
const { XPCOMUtils } = require("resource://gre/modules/XPCOMUtils.jsm");
const Services = require("Services");
const { NetUtil } = require("resource://gre/modules/NetUtil.jsm");

/**
 * This module wires up a browser tab as described by Firefox's tabbrowser.xml
 * to an <iframe mozbrowser> browser element.  It's meant to take the place of
 * the <xul:browser> element in a browser tab.
 *
 * The <iframe mozbrowser> element is _just_ the content.  It is not enough to
 * to replace <xul:browser> on its own.  <xul:browser> comes along with lots of
 * associated functionality via XBL bindings defined for such elements in
 * browser.xml and remote-browser.xml.
 */

/*function makeNestedBrowser(outerBrowser) {
  return new Proxy(outerBrowser, {

    get(target, property, receiver) {
      dump(`Accessing prop ${property}\n`);
      //return Reflect.get(target, property, target);

      let value = target[property];
      //if (value && value.bind) {
      //  value = value.bind(target);
      //}
      if (typeof value == "function") {
        return function() {
          return value.apply(target, arguments);
        };
      }
      return value;
    },

  });
}*/

function makeNestedBrowser(outer, inner) {
  let originalProperties = {};

  let propertiesToBackup = [
    "_webNavigation",
  ];

  return {

    connect() {
      for (let property of propertiesToBackup) {
        originalProperties[property] = outer[property];
      }
      outer._webNavigation = new BrowserElementWebNavigation(inner);
      Object.defineProperty(outer, "contentTitle", {
        value: "???",
        writable: false,
        configurable: true,
        enumerable: true,
      });

      // Setting getters, etc. is not valid before the swap, since only specific
      // fields are transferred.
    },

    disconnect() {
      for (let property of propertiesToBackup) {
        outer[property] = originalProperties[property];
      }
    },

  };
}

exports.makeNestedBrowser = makeNestedBrowser;

function makeURI(url) {
  return Services.io.newURI(url, null, null);
}

function readInputStreamToString(stream) {
  return NetUtil.readInputStreamToString(stream, stream.available());
}

function BrowserElementWebNavigation(browser) {
  this._browser = browser;
}

BrowserElementWebNavigation.prototype = {

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIWebNavigation,
    Ci.nsISupports
  ]),

  LOAD_FLAGS_MASK: 65535,
  LOAD_FLAGS_NONE: 0,
  LOAD_FLAGS_IS_REFRESH: 16,
  LOAD_FLAGS_IS_LINK: 32,
  LOAD_FLAGS_BYPASS_HISTORY: 64,
  LOAD_FLAGS_REPLACE_HISTORY: 128,
  LOAD_FLAGS_BYPASS_CACHE: 256,
  LOAD_FLAGS_BYPASS_PROXY: 512,
  LOAD_FLAGS_CHARSET_CHANGE: 1024,
  LOAD_FLAGS_STOP_CONTENT: 2048,
  LOAD_FLAGS_FROM_EXTERNAL: 4096,
  LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP: 8192,
  LOAD_FLAGS_FIRST_LOAD: 16384,
  LOAD_FLAGS_ALLOW_POPUPS: 32768,
  LOAD_FLAGS_BYPASS_CLASSIFIER: 65536,
  LOAD_FLAGS_FORCE_ALLOW_COOKIES: 131072,

  STOP_NETWORK: 1,
  STOP_CONTENT: 2,
  STOP_ALL: 3,

  get _mm() {
    return this._browser.frameLoader.messageManager;
  },

  canGoBack: false,
  canGoForward: false,
  goBack: function() {
    this._sendMessage("WebNavigation:GoBack", {});
  },
  goForward: function() {
    this._sendMessage("WebNavigation:GoForward", {});
  },
  gotoIndex: function(index) {
    this._sendMessage("WebNavigation:GotoIndex", { index });
  },
  loadURI: function(uri, flags, referrer, postData, headers) {
    this.loadURIWithOptions(uri, flags, referrer,
                            Ci.nsIHttpChannel.REFERRER_POLICY_DEFAULT,
                            postData, headers, null);
  },
  loadURIWithOptions: function(uri, flags, referrer, referrerPolicy,
                               postData, headers, baseURI) {
    this._sendMessage("WebNavigation:LoadURI", {
      uri,
      flags,
      referrer: referrer ? referrer.spec : null,
      referrerPolicy: referrerPolicy,
      postData: postData ? readInputStreamToString(postData) : null,
      headers: headers ? readInputStreamToString(headers) : null,
      baseURI: baseURI ? baseURI.spec : null,
    });
  },
  reload: function(flags) {
    dump(`Reload inner browser\n`)
    this._browser.reload(true);
    /*this._sendMessage("WebNavigation:Reload", { flags });*/
  },
  stop: function(flags) {
    this._sendMessage("WebNavigation:Stop", { flags });
  },

  get document() {
    return this._browser.contentDocument;
  },

  _currentURI: null,
  get currentURI() {
    if (!this._currentURI) {
      this._currentURI = makeURI("about:blank");
    }

    return this._currentURI;
  },
  set currentURI(uri) {
    this.loadURI(uri.spec, null, null, null);
  },

  referringURI: null,

  // Bug 1233803 - accessing the sessionHistory of remote browsers should be
  // done in content scripts.
  get sessionHistory() {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  set sessionHistory(aValue) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  _sendMessage: function(message, data) {
    try {
      this._mm.sendAsyncMessage(message, data);
    } catch (e) {
      Cu.reportError(e);
    }
  },

  swapBrowser: function(browser) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

};
