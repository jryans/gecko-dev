/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

loader.lazyRequireGetter(this, "TargetFactory", "devtools/client/framework/target", true);

/**
 * Provides the resources API for a single type of item, such as frames, workers,
 * processes, etc.
 */
class ResourceGroup {
  constructor(type, front) {
    this.type = type;
    this.front = front;
  }

  destroy() {
    this.front = null;
    this.resources = null;
    for (const target of this.targets) {
      target.destroy();
    }
    this.targets = null;
  }

  // TODO(jryans): The console case really only needs to know about remote things, but
  // we're currently listing all frames.  Should there be a "new targets only" filter
  // somehow?
  async find() {
    // TODO(jryans): Deduplicate with known resources and emit changes event to listeners
    const results = await this.front.find(this.type);
    this.resources = results;
    // TODO(jryans): Deduplicate with known targets and emit changes event to listeners
    const targets = await Promise.all(
      results.filter(isTargetForm).map(form => this.createTarget(form))
    );
    this.targets = targets;
    return {
      results,
      targets,
    };
  }

  // listen(type) { },

  createTarget(form) {
    const client = this.front.conn;
    switch (this.type) {
      case "Frame":
        return TargetFactory.forRemoteTab({
          form,
          client,
          chrome: false,
        });
      case "Process":
        return TargetFactory.forRemoteTab({
          form,
          client,
          chrome: true,
          isBrowsingContext: false
        });
      default:
        throw new Error(`Unexpected resource type: ${this.type}`);
    }
  }
}

function isTargetForm(input) {
  if (!input) {
    return false;
  }
  if (typeof input != "object") {
    return false;
  }
  if (!input.actor) {
    return false;
  }
  return true;
}

exports.ResourceGroup = ResourceGroup;
