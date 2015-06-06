/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Synchronizer = exports.Synchronizer = function(owner) {
  this.owner = owner;
  this.viewports = owner.viewports;
  this.onViewportAdded = this.onViewportAdded.bind(this);
  this.onEventOverheard = this.onEventOverheard.bind(this);
  this.owner.on("viewport-added", this.onViewports);
};

Synchronizer.prototype = {

  get syncs() {
    return this.viewports.map(v => v.responsiveBrowser.viewportTarget.sync);
  },

  destroy() {
    this.owner.off("viewport-added", this.onViewportAdded);
    this.stop();
    this.owner = null;
    this.viewports = null;
  },

  onViewportAdded(_, viewport) {
    this.viewports = this.owner.viewports;
    let sync = viewport.responsiveBrowser.viewportTarget.sync;
    sync.on("overheard", this.onEventOverheard);
    sync.listen();
  },

  start() {
    this.syncs.forEach(sync => {
      sync.on("overheard", this.onEventOverheard);
      sync.listen();
    });
  },

  stop() {
    this.syncs.forEach(sync => {
      sync.off("overheard", this.onEventOverheard);
      sync.unlisten();
    });
  },

  onEventOverheard(event) {
    console.log(event);
  },

};
