/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cu } = require("chrome");
const ObjectClient = require("devtools/shared/client/object-client");

const defer = require("devtools/shared/defer");
const EventEmitter = require("devtools/shared/event-emitter");
const { Task } = require("devtools/shared/task");

/**
 * This object represents DOM panel. It's responsibility is to
 * render Document Object Model of the current debugger target.
 */
function LayoutFrameInspectorPanel(iframeWindow, toolbox) {
  this.panelWin = iframeWindow;
  this._toolbox = toolbox;

  this.onTabNavigated = this.onTabNavigated.bind(this);
  this.onContentMessage = this.onContentMessage.bind(this);
  this.onPanelVisibilityChange = this.onPanelVisibilityChange.bind(this);

  this.pendingRequests = new Map();

  EventEmitter.decorate(this);
}

LayoutFrameInspectorPanel.prototype = {
  /**
   * Open is effectively an asynchronous constructor.
   *
   * @return object
   *         A promise that is resolved when the DOM panel completes opening.
   */
  open: Task.async(function* () {
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
  }),

  // Initialization

  initialize: function() {
    this.panelWin.addEventListener("devtools/content/message",
      this.onContentMessage, true);

    this.target.on("navigate", this.onTabNavigated);
    this._toolbox.on("select", this.onPanelVisibilityChange);

    // Export provider object with useful API for DOM panel.
    const provider = {
      getFrameTree: this.getFrameTree.bind(this),
      getPrototypeAndProperties: this.getPrototypeAndProperties.bind(this),
      openLink: this.openLink.bind(this),
    };

    // TODO: Maybe rename to client?
    exportIntoContentScope(this.panelWin, provider, "LFIProvider");

    this.shouldRefresh = true;
  },

  destroy: Task.async(function* () {
    if (this._destroying) {
      return this._destroying;
    }

    const deferred = defer();
    this._destroying = deferred.promise;

    this.target.off("navigate", this.onTabNavigated);
    this._toolbox.off("select", this.onPanelVisibilityChange);

    this.emit("destroyed");

    deferred.resolve();
    return this._destroying;
  }),

  // Events

  refresh: function() {
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

    this.getRootGrip().then(rootGrip => {
      this.postContentMessage("initialize", rootGrip);
    });
  },

  /**
   * Make sure the panel is refreshed when the page is reloaded.
   * The panel is refreshed immediately if it's currently selected
   * or lazily  when the user actually selects it.
   */
  onTabNavigated: function() {
    this.shouldRefresh = true;
    this.refresh();
  },

  /**
   * Make sure the panel is refreshed (if needed) when it's selected.
   */
  onPanelVisibilityChange: function() {
    this.refresh();
  },

  // Helpers

  /**
   * Return true if the panel is currently selected.
   */
  isPanelVisible: function() {
    return this._toolbox.currentToolId == "layoutframeinspector";
  },

  getPrototypeAndProperties: function(grip) {
    const deferred = defer();

    if (!grip.actor) {
      console.error("No actor!", grip);
      deferred.reject(new Error("Failed to get actor from grip."));
      return deferred.promise;
    }

    // Bail out if target doesn't exist (toolbox maybe closed already).
    if (!this.target) {
      return deferred.promise;
    }

    // If a request for the grips is already in progress
    // use the same promise.
    const request = this.pendingRequests.get(grip.actor);
    if (request) {
      return request;
    }

    const client = new ObjectClient(this.target.client, grip);
    client.getPrototypeAndProperties(response => {
      this.pendingRequests.delete(grip.actor, deferred.promise);
      deferred.resolve(response);

      // Fire an event about not having any pending requests.
      if (!this.pendingRequests.size) {
        this.emit("no-pending-requests");
      }
    });

    this.pendingRequests.set(grip.actor, deferred.promise);

    return deferred.promise;
  },

  async getFrameTree() {
    await this._toolbox.initInspector();
    const layoutInspector = await this._toolbox.walker.getLayoutInspector();
    return layoutInspector.getFrameTree();
  },

  openLink: function(url) {
    const parentDoc = this._toolbox.doc;
    const iframe = parentDoc.getElementById("this._toolbox");
    const top = iframe.ownerDocument.defaultView.top;
    top.openUILinkIn(url, "tab");
  },

  getRootGrip: function() {
    const deferred = defer();

    // Attach Console. It might involve RDP communication, so wait
    // asynchronously for the result
    this.target.activeConsole.evaluateJSAsync("window", res => {
      deferred.resolve(res.result);
    });

    return deferred.promise;
  },

  postContentMessage: function(type, args) {
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

  onContentMessage: function(event) {
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
