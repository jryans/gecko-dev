/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { Front, FrontClassWithSpec, custom } = require("devtools/shared/protocol");
const { resourcesSpec } = require("devtools/shared/specs/resources/resources");

loader.lazyRequireGetter(this, "assert", "devtools/shared/DevToolsUtils", true);
loader.lazyRequireGetter(this, "TargetFactory", "devtools/client/framework/target", true);

/**
 * The corresponding Front object for the ResourcesActor.
 */
const ResourcesFront = FrontClassWithSpec(resourcesSpec, {
  initialize: function(client, form) {
    Front.prototype.initialize.call(this, client);
    this.actorID = form.resourcesActor;
    this.manage(this);
    this.resourcesByType = new Map();
    this.targetsByType = new Map();
  },

  destroy: function() {
    this.resourcesByType = null;
    for (const targets of this.targetsByType.values()) {
      for (const target of targets) {
        target.destroy();
      }
    }
    this.targetsByType = null;
    Front.prototype.destroy.call(this);
  },

  // TODO(jryans): The console case really only needs to know about remote things, but
  // we're currently listing all frames.  Should there be a "new targets only" filter
  // somehow?
  find: custom(async function(type) {
    // TODO(jryans): Use an enum to ease things for clients
    assert(type == "Frame", `Unexpected resource type: ${type}`);
    // TODO(jryans): Deduplicate with known resources and emit changes event to listeners
    const results = await this._find(type);
    this.resourcesByType.set(type, results);
    // TODO(jryans): Deduplicate with known targets and emit changes event to listeners
    const targets = await Promise.all(results.filter(isTargetForm).map(form => {
      return TargetFactory.forRemoteTab({
        form,
        client: this.conn,
        chrome: false,
      });
    }));
    this.targetsByType.set(type, targets);
    return {
      results,
      targets,
    };
  }, {
    impl: "_find"
  }),

  // listen(type) { },
});

function isTargetForm(input) {
  if (!input) {
    return false;
  }
  if (typeof input != "object") {
    return false;
  }
  if (!input.actor || !input.url) {
    return false;
  }
  return true;
}

exports.ResourcesFront = ResourcesFront;
