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
    this.onPickedFrame = this.onPickedFrame.bind(this);

    this.root = document.querySelector("#root");
    this.frameTree = JSON.parse(await LFIProvider.getFrameTree());
    this.highlighter = await LFIProvider.getHighlighter();
    LFIProvider.on("frame-picked", this.onPickedFrame);
    this.highlighter.pick();
    this.render();
  },

  // jryans: Call this somewhere...
  destroy() {
    LFIProvider.off("frame-picked", this.onPickedFrame);
    this.frameTree = null;
    this.highlighter = null;
  },

  handleEvent(event) {
    const data = event.data;
    const method = data.type;

    if (typeof this[method] == "function") {
      this[method](data.args);
    }
  },

  onPickedFrame(frameID) {
    this.pickedFrameID = frameID;
    this.render();
  },

  render() {
    const {
      frameTree,
      pickedFrameID,
    } = this;

    const app = createElement(App, {
      frameTree,
      pickedFrameID,
    });
    ReactDOM.render(app, this.root);
  },
};

addEventListener("devtools/chrome/message", bootstrap, true);

// XXX: Defined for JSONView components to work...
window.JSONView = {
  Locale: {
    $STR: msg => msg,
  },
};
