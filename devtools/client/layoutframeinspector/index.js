/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env browser */
/* global LFIProvider */

"use strict";

const { utils: Cu } = Components;
const { BrowserLoader } = Cu.import("resource://devtools/client/shared/browser-loader.js", {});
const { require } = BrowserLoader({
  baseURI: "resource://devtools/client/layoutframeinspector/",
  window,
});

const { createFactory, createElement } =
  require("devtools/client/shared/vendor/react");
const ReactDOM = require("devtools/client/shared/vendor/react-dom");
// const { Provider } = require("devtools/client/shared/vendor/react-redux");

const App = createFactory(require("./components/App"));
// const Store = require("./store");

// Exposed for use by tests
window.require = require;

const bootstrap = {
  async init(rootGrip) {
    const root = document.querySelector("#root");
    const frameTree = await LFIProvider.getFrameTree();
    const app = createElement(App, {
      frameTree: JSON.parse(frameTree),
    });
    ReactDOM.render(app, root);
  },

  handleEvent(event) {
    const data = event.data;
    const method = data.type;

    if (typeof this[method] == "function") {
      this[method](data.args);
    }
  },
};

addEventListener("devtools/chrome/message", bootstrap, true);

// XXX: Defined for JSONView components to work...
window.JSONView = {
  Locale: {
    $STR: msg => msg,
  },
};
