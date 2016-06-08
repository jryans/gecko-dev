/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Ci, Cu, Cr } = require("chrome");
const { XPCOMUtils } = require("resource://gre/modules/XPCOMUtils.jsm");
const Services = require("Services");
const { NetUtil } = require("resource://gre/modules/NetUtil.jsm");

function readInputStreamToString(stream) {
  return NetUtil.readInputStreamToString(stream, stream.available());
}

/**
 * This object aims to provide the nsIWebNavigation interface for mozbrowser elements.
 * nsIWebNavigation is one of the interfaces expected on <xul:browser>s, so this wrapper
 * helps mozbrowser elements support this.
 *
 * It attempts to use the mozbrowser API wherever possible, however some methods don't
 * exist yet, so we fallback to the WebNavigation frame script messages in those cases.
 * Ideally the mozbrowser API would eventually be extended to cover all properties and
 * methods used here.
 *
 * This is largely copied from RemoteWebNavigation.js, which uses the message manager to
 * perform all actions.
 */
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

  goBack() {
    this._browser.goBack();
  },

  goForward() {
    this._browser.goForward();
  },

  gotoIndex(index) {
    // No equivalent in the current BrowserElement API
    this._sendMessage("WebNavigation:GotoIndex", { index });
  },

  loadURI(uri, flags, referrer, postData, headers) {
    // No equivalent in the current BrowserElement API
    this.loadURIWithOptions(uri, flags, referrer,
                            Ci.nsIHttpChannel.REFERRER_POLICY_DEFAULT,
                            postData, headers, null);
  },

  loadURIWithOptions(uri, flags, referrer, referrerPolicy, postData, headers,
                     baseURI) {
    // No equivalent in the current BrowserElement API
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

  reload(flags) {
    let hardReload = false;
    if (flags & this.LOAD_FLAGS_BYPASS_PROXY ||
        flags & this.LOAD_FLAGS_BYPASS_CACHE) {
      hardReload = true;
    }
    this._browser.reload(hardReload);
  },

  stop(flags) {
    // No equivalent in the current BrowserElement API
    this._sendMessage("WebNavigation:Stop", { flags });
  },

  get document() {
    return this._browser.contentDocument;
  },

  _currentURI: null,
  get currentURI() {
    if (!this._currentURI) {
      this._currentURI = Services.io.newURI("about:blank", null, null);
    }
    return this._currentURI;
  },
  set currentURI(uri) {
    this._browser.src = uri.spec;
  },

  referringURI: null,

  // Bug 1233803 - accessing the sessionHistory of remote browsers should be
  // done in content scripts.
  get sessionHistory() {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  set sessionHistory(value) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  _sendMessage(message, data) {
    try {
      this._mm.sendAsyncMessage(message, data);
    } catch (e) {
      Cu.reportError(e);
    }
  },

  swapBrowser(browser) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  copyStateFrom(otherWebNavigation) {
    const state = [
      "canGoBack",
      "canGoForward",
      "_currentURI",
    ];
    for (let property of state) {
      this[property] = otherWebNavigation[property];
    }
  },

};

exports.BrowserElementWebNavigation = BrowserElementWebNavigation;
