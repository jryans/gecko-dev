/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { DOM: dom, createClass, createFactory } =
  require("devtools/client/shared/vendor/react");

const Models = require("../models");
const Viewport = createFactory(require("./viewport"));

module.exports = createClass({

  displayName: "Viewports",

  propTypes: Models.app,

  render() {
    let {
      location,
      viewports,
    } = this.props;

    let children = viewports.map((viewport, index) => {
      return Viewport({
        key: index,
        location,
        viewport,
      });
    });

    return dom.div({
      id: "viewports",
    }, children);
  },

});
