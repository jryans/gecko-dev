/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cu } = require("chrome");

const defer = require("devtools/shared/defer");
const EventEmitter = require("devtools/shared/event-emitter");

loader.lazyRequireGetter(this, "getFront", "devtools/shared/protocol", true);

/**
 * This object represents the Layout Frame Inspector panel.  It displays the frame tree
 * for the target window.
 */
function LayoutFrameInspectorPanel(iframeWindow, toolbox) {
  this.panelWin = iframeWindow;
  this._toolbox = toolbox;

  this.onTabNavigated = this.onTabNavigated.bind(this);
  this.onContentMessage = this.onContentMessage.bind(this);
  this.onPanelVisibilityChange = this.onPanelVisibilityChange.bind(this);

  EventEmitter.decorate(this);
}

LayoutFrameInspectorPanel.prototype = {
  async open() {
    if (this._opening) {
      return this._opening;
    }

    const deferred = defer();
    this._opening = deferred.promise;

    this.initialize();

    this.isReady = true;
    this.emit("ready");
    deferred.resolve(this);

    return this._opening;
  },

  // Initialization

  initialize() {
    this.panelWin.addEventListener("devtools/content/message",
      this.onContentMessage, true);

    this.target.on("navigate", this.onTabNavigated);
    this._toolbox.on("select", this.onPanelVisibilityChange);

    // Export provider API to the panel content to give it access to the data about the
    // target needed to present the UI.
    const provider = {
      getFrameTree: this.getFrameTree.bind(this),
      getHighlighter: this.getHighlighter.bind(this),
      on: this.onProvider.bind(this),
      off: this.offProvider.bind(this),
    };

    // TODO: Maybe rename to client?
    exportIntoContentScope(this.panelWin, provider, "LFIProvider");

    this.shouldRefresh = true;
  },

  async destroy() {
    if (this._destroying) {
      return this._destroying;
    }

    const deferred = defer();
    this._destroying = deferred.promise;

    if (this._layoutFrameInspector) {
      this._layoutFrameInspector.destroy();
      this._layoutFrameInspector = null;
    }

    this.target.off("navigate", this.onTabNavigated);
    this._toolbox.off("select", this.onPanelVisibilityChange);

    this.emit("destroyed");

    deferred.resolve();
    return this._destroying;
  },

  // Events

  refresh() {
    // Do not refresh if the panel isn't visible.
    if (!this.isPanelVisible()) {
      return;
    }

    // Do not refresh if it isn't necessary.
    if (!this.shouldRefresh) {
      return;
    }

    // Alright reset the flag we are about to refresh the panel.
    this.shouldRefresh = false;

    this.postContentMessage("init");
  },

  /**
   * Make sure the panel is refreshed when the page is reloaded.
   * The panel is refreshed immediately if it's currently selected
   * or lazily  when the user actually selects it.
   */
  onTabNavigated() {
    this.shouldRefresh = true;
    this.refresh();
  },

  /**
   * Make sure the panel is refreshed (if needed) when it's selected.
   */
  onPanelVisibilityChange() {
    this.refresh();
  },

  // Provider

  getFrameTree() {
    return this.layoutFrameInspector.getFrameTree();
  },

  getHighlighter() {
    return this.layoutFrameInspector.getHighlighter();
  },

  onProvider(...args) {
    this.layoutFrameInspector.on(...args);
  },

  offProvider(...args) {
    this.layoutFrameInspector.off(...args);
  },

  // Helpers

  get layoutFrameInspector() {
    if (this._layoutFrameInspector) {
      return this._layoutFrameInspector;
    }
    const target = this._toolbox._target;
    this._layoutFrameInspector =
      getFront(target.client, "layoutFrameInspector", target.form);
    return this._layoutFrameInspector;
  },

  isPanelVisible() {
    return this._toolbox.currentToolId == "layoutframeinspector";
  },

  postContentMessage(type, args) {
    const data = {
      type: type,
      args: args,
    };

    const event = new this.panelWin.MessageEvent("devtools/chrome/message", {
      bubbles: true,
      cancelable: true,
      data: data,
    });

    this.panelWin.dispatchEvent(event);
  },

  onContentMessage(event) {
    const data = event.data;
    const method = data.type;
    if (typeof this[method] == "function") {
      this[method](data.args);
    }
  },

  get target() {
    return this._toolbox.target;
  },
};

// Helpers

function exportIntoContentScope(win, obj, defineAs) {
  const clone = Cu.createObjectIn(win, {
    defineAs: defineAs,
  });

  const props = Object.getOwnPropertyNames(obj);
  for (let i = 0; i < props.length; i++) {
    const propName = props[i];
    const propValue = obj[propName];
    if (typeof propValue == "function") {
      Cu.exportFunction(propValue, clone, {
        defineAs: propName,
      });
    }
  }
}

// Exports from this module
exports.LayoutFrameInspectorPanel = LayoutFrameInspectorPanel;
