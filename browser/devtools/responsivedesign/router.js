/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const promise = require("promise");
const { Task } = require("resource://gre/modules/Task.jsm");

let Router = exports.Router = function(owner) {
  this.owner = owner;
  this.onViewportAdded = this.onViewportAdded.bind(this);
  this.owner.on("viewport-added", this.onViewportAdded);
  this.routerViewports = [];
  this.owner.viewports.forEach(v => this.onViewportAdded(null, v));
};

Router.prototype = {

  destroy: Task.async(function*() {
    this.owner.off("viewport-added", this.onViewportAdded);
    yield this.stop();
    this.owner = null;
    this.routerViewports = null;
  }),

  onViewportAdded(_, viewport) {
    let routerViewport = new RouterViewport({
      router: this,
      viewport
    });
    this.routerViewports.push(routerViewport);
    if (this.active) {
      routerViewport.installProxy();
    }
  },

  start() {
    if (this.active) {
      return promise.resolve();
    }
    this.active = true;
    return promise.all(this.routerViewports.map(v => v.installProxy()));
  },

  stop() {
    if (!this.active) {
      return promise.resolve();
    }
    this.active = false;
    return promise.all(this.routerViewports.map(v => v.uninstallProxy()));
  },

};

let RouterViewport = function(options) {
  this.router = options.router;
  this.viewport = options.viewport;
};

RouterViewport.prototype = {

  get target() {
    return this.viewport.responsiveBrowser.viewportTarget.target;
  },

  get otherViewports() {
    return this.router.routerViewports.filter(v => v !== this);
  },

  installProxy: Task.async(function*() {
    let target = yield this.target;
    let transport = target.client._transport;
    if (transport.proxy) {
      // Already installed
      return;
    }
    let proxy = new TransportProxy(transport);
    target.client._transport = new Proxy(transport, proxy);
  }),

  uninstallProxy: Task.async(function*() {
    let target = yield this.target;
    if (!target.client) {
      return;
    }
    let transport = target.client._transport;
    if (!transport.proxy) {
      // Already uninstalled
      return;
    }
    transport.proxy.destroy();
    target.client._transport = transport.target;
  }),

};

function TransportProxy(target) {
  this.target = target;
  this.hooks = this.target.hooks;
  this.target.hooks = new Proxy(this.hooks, this);
}

TransportProxy.prototype = {

  target: null,

  hooks: null,

  get proxy() {
    return this;
  },

  destroy() {
    this.target.hooks = this.hooks;
  },

  get(target, name) {
    if (this[name]) {
      return this[name];
    }
    return target[name];
  },

  send(packet) {
    this.target.send(packet);
  },

  onPacket(packet) {
    this.hooks.onPacket(packet);
  },

};
