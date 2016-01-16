/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { PropTypes } = require("devtools/client/shared/vendor/react");

let viewport = exports.viewport = {

  // The width of the viewport
  width: PropTypes.number.isRequired,

  // The height of the viewport
  height: PropTypes.number.isRequired,

};

exports.app = {

  // The location of the document displayed in the viewport(s)
  location: PropTypes.string.isRequired,

  // Array of one or more viewports to display the document
  viewports: PropTypes.arrayOf(PropTypes.shape(viewport)).isRequired,

};
