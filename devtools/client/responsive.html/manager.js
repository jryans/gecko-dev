/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * ResponsiveUIManager is the external API for the browser UI, etc. to use when
 * open and closing the responsive UI.
 *
 * While the HTML UI is in an experimental stage, the older ResponsiveUIManager
 * from devtools/client/responsivedesign/responsivedesign.jsm delegates to this
 * object when the pref "devtools.responsive.html.enabled" is true.
 */
exports.ResponsiveUIManager = {
  _activeTabs: new Map(),

  /**
   * Toggle the responsive UI for a tab.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   */
  toggle(window, tab) {
    if (this.isActiveForTab(tab)) {
      this._activeTabs.get(tab).close();
    } else {
      this.runIfNeeded(window, tab);
    }
  },

  /**
   * Launches the responsive UI.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   */
  runIfNeeded(window, tab) {
    if (!this.isActiveForTab(tab)) {
      // TODO: Unimplemented
    }
  },

  /**
   * Returns true if responsive UI is active for a given tab.
   *
   * @param tab
   *        The browser tab.
   * @return boolean
   */
  isActiveForTab(tab) {
    return this._activeTabs.has(tab);
  },

  /**
   * Return the responsive UI controller for a tab.
   *
   * @param tab
   *        The browser tab.
   * @return TODO: Some object!
   */
  getResponsiveUIForTab(tab) {
    return this._activeTabs.get(tab);
  },

  /**
   * Handle GCLI commands.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   * @param command
   *        The GCLI command name.
   * @param args
   *        The GCLI command arguments.
   */
  handleGcliCommand: function(window, tab, command, args) {
    switch (command) {
      case "resize to":
        this.runIfNeeded(window, tab);
        // TODO: Probably the wrong API
        this._activeTabs.get(tab).setSize(args.width, args.height);
        break;
      case "resize on":
        this.runIfNeeded(window, tab);
        break;
      case "resize off":
        if (this.isActiveForTab(tab)) {
          // TODO: Probably the wrong API
          this._activeTabs.get(tab).close();
        }
        break;
      case "resize toggle":
        this.toggle(window, tab);
        break;
      default:
    }
  }
};
