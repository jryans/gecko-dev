/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Create a simple enum-like object with keys mirrored to values from an array.
 * This makes comparison to a specfic value simpler without having to repeat and
 * mis-type the value.
 */
function createEnum(array, target) {
  for (let key of array) {
    target[key] = key;
  }
  return target;
}

createEnum([

  // The location of the page has changed.  This may be triggered by the user
  // directly entering a new URL, navigating with links, etc.
  "CHANGE_LOCATION",

  // Add an additional viewport to display the document.
  "ADD_VIEWPORT",

], module.exports);
