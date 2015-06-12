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
  this.onWillNavigate = this.onWillNavigate.bind(this);
  this.listeningPausedFor = new Set();
};

SyncViewport.prototype = {

  listeningPausedFor: null,

  get sync() {
    return this.viewport.responsiveBrowser.viewportTarget.sync;
  },

  get target() {
    return this.viewport.responsiveBrowser.viewportTarget.target;
  },

  get otherViewports() {
    return this.synchronizer.syncViewports.filter(v => v !== this);
  },

  listenFor: {
    "scroll": { from: "sync", method: "onScroll" },
    "will-navigate": { from: "target", method: "onWillNavigate" },
  },

  addHandlers: Task.async(function*() {
    for (let type in this.listenFor) {
      let routing = this.listenFor[type];
      let source = yield this[routing.from];
      source.on(type, this[routing.method]);
    }
    yield this.sync.listen();
  }),

  removeHandlers: Task.async(function*() {
    for (let type in this.listenFor) {
      let routing = this.listenFor[type];
      let source = yield this[routing.from];
      source.off(type, this[routing.method]);
    }
    try {
      yield this.sync.unlisten();
    } catch(e) {
      // May fail if tab is already gone, but actor should have cleaned up
    }
  }),

  pause(type) {
    this.listeningPausedFor.add(type);
  },

  isPaused(type) {
    if (this.listeningPausedFor.has(type)) {
      this.listeningPausedFor.delete(type);
      return true;
    }
    return false;
  },

  onScroll(eventSpec) {
    if (this.isPaused(eventSpec.type)) {
      return;
    }
    this.otherViewports.forEach(v => {
      // Pause scroll listening, since this will generate a scroll event
      v.pause(eventSpec.type);
      v.sync.dispatch(eventSpec);
    });
  },

  onWillNavigate(type, { url }) {
    if (this.isPaused(type)) {
      return;
    }
    this.otherViewports.forEach(v => {
      // Pause navigate listening, since this will generate a navigate event
      v.pause(type);
      v.sync.navigate(url);
    });
  },

};
