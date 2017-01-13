/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env browser */

"use strict";

const { DOM: dom, createClass, PropTypes, addons } =
  require("devtools/client/shared/vendor/react");

const { Ci } = require("chrome");
const Types = require("../types");
const { getStr, getFormatStr } = require("../utils/l10n");

const PIXEL_RATIO_PRESET = [1, 2, 3];

const createVisibleOption = value =>
  dom.option({
    value,
    title: value,
    key: value,
  }, value);

const createHiddenOption = value =>
  dom.option({
    value,
    title: value,
    hidden: true,
    disabled: true,
  }, value);

module.exports = createClass({
  displayName: "DPRSelector",

  propTypes: {
    devices: PropTypes.shape(Types.devices).isRequired,
    displayPixelRatio: PropTypes.number.isRequired,
    selectedDevice: PropTypes.string.isRequired,
    selectedPixelRatio: PropTypes.number.isRequired,
    onChangeViewportPixelRatio: PropTypes.func.isRequired,
  },

  mixins: [ addons.PureRenderMixin ],

  getInitialState() {
    return {
      isFocused: false
    };
  },

  onButtonClick() {
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIDOMWindowUtils);
    let rect = this.selectElem.getBoundingClientRect();
    utils.sendMouseEvent("mousedown", rect.left + 2, rect.top + 2, 0, 1, 0);
    utils.sendMouseEvent("mouseup", rect.left + 2, rect.top + 2, 0, 1, 0);
  },

  onFocusChange({type}) {
    this.setState({
      isFocused: type === "focus"
    });
  },

  onSelectChange({ target }) {
    this.props.onChangeViewportPixelRatio(+target.value);
  },

  render() {
    let {
      devices,
      displayPixelRatio,
      selectedDevice,
      selectedPixelRatio,
    } = this.props;

    let hiddenOptions = [];

    for (let type of devices.types) {
      for (let device of devices[type]) {
        if (device.displayed &&
            !hiddenOptions.includes(device.pixelRatio) &&
            !PIXEL_RATIO_PRESET.includes(device.pixelRatio)) {
          hiddenOptions.push(device.pixelRatio);
        }
      }
    }

    if (!PIXEL_RATIO_PRESET.includes(displayPixelRatio)) {
      hiddenOptions.push(displayPixelRatio);
    }

    let state = devices.listState;
    let isDisabled = (state !== Types.deviceListState.LOADED) || (selectedDevice !== "");
    let selectorClass = "viewport-dpr-button toolbar-button devtools-button";
    let title;

    if (isDisabled) {
      selectorClass += " disabled";
      title = getFormatStr("responsive.autoDPR", selectedDevice);
    } else {
      title = getStr("responsive.devicePixelRatio");

      if (selectedPixelRatio) {
        selectorClass += " selected";
      }
    }

    if (this.state.isFocused) {
      selectorClass += " focused";
    }

    let listContent = PIXEL_RATIO_PRESET.map(createVisibleOption);

    if (state == Types.deviceListState.LOADED) {
      listContent = listContent.concat(hiddenOptions.map(createHiddenOption));
    }

    return dom.span(
      {
        id: "global-dpr-selector",
      },
      dom.button(
        {
          className: selectorClass,
          title,
          onClick: this.onButtonClick,
        }
      ),
      dom.select(
        {
          ref: elem => {
            this.selectElem = elem;
          },
          value: selectedPixelRatio || displayPixelRatio,
          disabled: isDisabled,
          onChange: this.onSelectChange,
          onFocus: this.onFocusChange,
          onBlur: this.onFocusChange,
        },
        ...listContent
      )
    );
  },

});
