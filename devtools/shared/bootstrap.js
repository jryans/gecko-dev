/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* eslint-env browser */
/* global SpecialPowers */
/* eslint-disable no-inline-comments */

(function () {
  if (window.QueryInterface) { // root document of toolbox (chrome privilege)
    const { utils: Cu, interfaces: Ci } = Components;
    const { BrowserLoader } =
      Cu.import("resource://devtools/client/shared/browser-loader.js", {});

    // Install require() for the root document
    const rootLoader = BrowserLoader({
      baseURI: "resource://devtools/client/",
      window,
    });
    window.require = rootLoader.require;

    // Watch for all child (content privilege) frames and install require() on each
    let browser = window.QueryInterface(Ci.nsIInterfaceRequestor)
                        .getInterface(Ci.nsIWebNavigation)
                        .QueryInterface(Ci.nsIDocShell)
                        .chromeEventHandler;
    browser.addEventListener("DOMWindowCreated", event => {
      let win = event.target.defaultView.wrappedJSObject;
      const frameLoader = BrowserLoader({
        baseURI: "resource://devtools/client/",
        window: win,
      });
      win.require = frameLoader.require;
    });
  } else if (window.SpecialPowers) { // mochitest plain (content privilege)
    const { BrowserLoader } =
      SpecialPowers.Cu.import("resource://devtools/client/shared/browser-loader.js", {});
    const { require } = BrowserLoader({
      baseURI: "resource://devtools/client/",
      window,
    });
    window.require = require;
    /* SpecialPowers.loadChromeScript(() => {
      function bootstrap() {
        dump(`FRAME: ${content.location}\n`);
        const { utils: Cu } = Components;
        const { BrowserLoader } =
          Cu.import("resource://devtools/client/shared/browser-loader.js", {});
        const { require } = BrowserLoader({
          baseURI: "resource://devtools/client/",
          window: content,
        });
        content.require = require;
      }
      dump(`INSTALL\n`);
      let mm = browserElement.frameLoader.messageManager;
      mm.loadFrameScript(`data:,(${bootstrap})();`, false);
    }); */
  } else { // regular web page
    // TODO: Inject optimized bundle here / replace this file with bundle.
    //       The bundle exposes require() for the page to use.
  }
})();
