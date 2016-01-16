/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { DOM: dom, createClass } =
  require("devtools/client/shared/vendor/react");

const Models = require("../models");

module.exports = createClass({

  displayName: "Browser",

  propTypes: {
    location: Models.app.location,
    width: Models.viewport.width,
    height: Models.viewport.height,
  },

  render() {
    let {
      location,
      width,
      height,
    } = this.props;

    return dom.iframe({
      className: "browser",
      src: location,
      width,
      height,
    });
  },

});
