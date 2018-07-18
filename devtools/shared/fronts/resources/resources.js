/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Front, FrontClassWithSpec } = require("devtools/shared/protocol");
const { resourcesSpec } = require("devtools/shared/specs/resources/resources");

loader.lazyRequireGetter(this, "assert", "devtools/shared/DevToolsUtils", true);
loader.lazyRequireGetter(this, "ResourceGroup", "devtools/shared/fronts/resources/group", true);

/**
 * The resources API is focused around discovery of "types", such as frames, workers,
 * processes, etc. The resources front provides access to each type separately, such as
 * `resources.frames.<method>`. For each supported type, the following methods are
 * available:
 *
 * find(filters = {}) →
 * { results: Array of <type> actors, targets: Array of <type> targets }
 * Find all of the <type> things in this target and all supplemental targets that descend
 * from it. filters may be added for more precise control where as needed, such as only
 * looking in the current target, process, etc. Additionally, targets are created for
 * those that are remote from this target.
 *
 * query(({ target }) => { ... })
 * Run a callback for each of the <type> things in this target and all supplemental
 * targets that descend from it.
 *
 * listen(filters = {}, handler)
 * Listen for added and removed events. Actor uses ref counting to stop listening at the
 * platform layer when all clients have unlistened.
 *
 * unlisten(filters = {}, handler)
 * Stop listening for added and removed events. Actor uses ref counting to stop listening
 * at the platform layer when all clients have unlistened.
 *
 * added event
 * Emitted when a <type> is added. An object with additional details is also emitted. If
 * there is a related target, that is included as the target property.
 *
 * removed event
 * Emitted when a <type> is removed. An object with additional details is also emitted. If
 * there is a related target, that is included as the target property. In the case of a
 * frame that is reassigned to a new process, the sequence of removed and added will be
 * emitted.
 */
const ResourcesFront = FrontClassWithSpec(resourcesSpec, {
  initialize(client, form) {
    Front.prototype.initialize.call(this, client);
    this.actorID = form.resourcesActor;
    this.manage(this);
    this.resourceGroupsByType = new Map();
    this.on("added", this.onAdded);
    this.on("removed", this.onRemoved);
  },

  destroy() {
    for (const group of this.resourceGroupsByType.values()) {
      group.destroy();
    }
    this.resourceGroupsByType = null;
    this.off();
    Front.prototype.destroy.call(this);
  },

  getOrCreateGroup(type) {
    if (this.resourceGroupsByType.has(type)) {
      return this.resourceGroupsByType.get(type);
    }
    const group = new ResourceGroup(type, this);
    this.resourceGroupsByType.set(type, group);
    return group;
  },

  get frames() {
    return this.getOrCreateGroup("Frame");
  },

  get processes() {
    return this.getOrCreateGroup("Process");
  },

  onAdded(type, ...args) {
    const group = this.getOrCreateGroup(type);
    assert(group, `Unexpected resource type: ${type}`);
    group.emit("added", ...args);
  },

  onRemoved(type, ...args) {
    const group = this.getOrCreateGroup(type);
    assert(group, `Unexpected resource type: ${type}`);
    group.emit("removed", ...args);
  },
});

exports.ResourcesFront = ResourcesFront;
