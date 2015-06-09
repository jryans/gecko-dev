/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const promise = require("promise");
const { Task } = require("resource://gre/modules/Task.jsm");

let Synchronizer = exports.Synchronizer = function(owner) {
  this.owner = owner;
  this.onViewportAdded = this.onViewportAdded.bind(this);
  this.owner.on("viewport-added", this.onViewportAdded);
  this.syncViewports = [];
  this.owner.viewports.forEach(v => this.onViewportAdded(null, v));
};

Synchronizer.prototype = {

  destroy: Task.async(function*() {
    this.owner.off("viewport-added", this.onViewportAdded);
    yield this.stop();
    this.owner = null;
    this.syncViewports = null;
  }),

  onViewportAdded(_, viewport) {
    let syncViewport = new SyncViewport({
      synchronizer: this,
      viewport
    });
    this.syncViewports.push(syncViewport);
    if (this.active) {
      syncViewport.addHandlers();
    }
  },

  start() {
    if (this.active) {
      return promise.resolve();
    }
    this.active = true;
    return promise.all(this.syncViewports.map(v => v.addHandlers()));
  },

  stop() {
    if (!this.active) {
      return promise.resolve();
    }
    this.active = false;
    return promise.all(this.syncViewports.map(v => v.removeHandlers()));
  },

};

let SyncViewport = function(options) {
  this.synchronizer = options.synchronizer;
  this.viewport = options.viewport;
  this.onScroll = this.onScroll.bind(this);
};

SyncViewport.prototype = {

  get sync() {
    return this.viewport.responsiveBrowser.viewportTarget.sync;
  },

  get otherViewports() {
    return this.synchronizer.syncViewports.filter(v => v !== this);
  },

  listenFor: {
    "scroll": "onScroll"
  },

  addHandlers: Task.async(function*() {
    for (let type in this.listenFor) {
      this.sync.on(type, this[this.listenFor[type]]);
    }
    yield this.sync.listen();
  }),

  removeHandlers: Task.async(function*() {
    for (let type in this.listenFor) {
      this.sync.off(type, this[this.listenFor[type]]);
    }
    yield this.sync.unlisten();
  }),

  onScroll(eventSpec) {
    this.otherViewports.forEach(v => v.sync.dispatch(eventSpec));
  },

};
