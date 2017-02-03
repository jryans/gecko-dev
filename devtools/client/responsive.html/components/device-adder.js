/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env browser */

"use strict";

const { DOM: dom, createClass, createFactory, PropTypes, addons } =
  require("devtools/client/shared/vendor/react");

const { getFormatStr, getStr } = require("../utils/l10n");
const Types = require("../types");
const ViewportDimension = createFactory(require("./viewport-dimension"));

module.exports = createClass({
  displayName: "DeviceAdder",

  propTypes: {
    devices: PropTypes.shape(Types.devices).isRequired,
    viewportTemplate: PropTypes.shape(Types.viewport).isRequired,
    onAddCustomDevice: PropTypes.func.isRequired,
  },

  mixins: [ addons.PureRenderMixin ],

  getInitialState() {
    return {};
  },

  componentWillReceiveProps(nextProps) {
    let {
      width,
      height,
    } = nextProps.viewportTemplate;

    this.setState({
      width,
      height,
    });
  },

  onChangeSize(width, height) {
    this.setState({
      width,
      height,
    });
  },

  onDeviceAdderShow() {
    this.setState({
      deviceAdderDisplayed: true,
    });
  },

  onDeviceAdderSave() {
    let {
      devices,
      onAddCustomDevice,
    } = this.props;
    if (!this.pixelRatioInput.checkValidity()) {
      return;
    }
    if (devices.custom.find(device => device.name == this.nameInput.value)) {
      this.nameInput.setCustomValidity("Device name already in use");
      return;
    }
    this.setState({
      deviceAdderDisplayed: false,
    });
    onAddCustomDevice({
      name: this.nameInput.value,
      width: this.state.width,
      height: this.state.height,
      pixelRatio: parseInt(this.pixelRatioInput.value, 10),
      userAgent: this.userAgentInput.value,
      touch: this.touchInput.checked,
    });
  },

  render() {
    let {
      devices,
      viewportTemplate,
    } = this.props;

    let {
      deviceAdderDisplayed,
      height,
      width,
    } = this.state;

    if (!deviceAdderDisplayed) {
      return dom.div(
        {
          id: "device-adder"
        },
        dom.button(
          {
            id: "device-adder-show",
            onClick: this.onDeviceAdderShow,
          },
          getStr("responsive.addDevice")
        )
      );
    }

    // If a device is currently selected, fold its attributes into single object for use
    // as the starting values of the form.  If no device is selected, use the values for
    // the current window.
    let deviceName;
    let normalizedViewport = Object.assign({}, viewportTemplate);
    if (viewportTemplate.device) {
      let device = devices[viewportTemplate.deviceType].find(elem => {
        return elem.name == viewportTemplate.device;
      });
      deviceName = getFormatStr("responsive.customDeviceName", device.name);
      Object.assign(normalizedViewport, {
        pixelRatio: device.pixelRatio,
        userAgent: device.userAgent,
        touch: device.touch,
      });
    } else {
      deviceName = "Custom Device";
      Object.assign(normalizedViewport, {
        pixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
        touch: false,
      });
    }

    return dom.div(
      {
        id: "device-adder"
      },
      dom.label(
        {},
        dom.span(
          {
            className: "device-adder-label",
          },
          getStr("responsive.deviceAdderName")
        ),
        dom.input({
          defaultValue: deviceName,
          ref: input => {
            this.nameInput = input;
          },
        })
      ),
      dom.label(
        {},
        dom.span(
          {
            className: "device-adder-label"
          },
          getStr("responsive.deviceAdderSize")
        ),
        ViewportDimension({
          viewport: {
            width,
            height,
          },
          onChangeSize: this.onChangeSize,
          onRemoveDeviceAssociation: () => {},
        })
      ),
      dom.label(
        {},
        dom.span(
          {
            className: "device-adder-label"
          },
          getStr("responsive.deviceAdderDPR")
        ),
        dom.input({
          type: "number",
          step: "any",
          defaultValue: normalizedViewport.pixelRatio,
          ref: input => {
            this.pixelRatioInput = input;
          },
        })
      ),
      dom.label(
        {},
        dom.span(
          {
            className: "device-adder-label"
          },
          getStr("responsive.deviceAdderUA")
        ),
        dom.input({
          defaultValue: normalizedViewport.userAgent,
          ref: input => {
            this.userAgentInput = input;
          },
        })
      ),
      dom.label(
        {},
        dom.span(
          {
            className: "device-adder-label"
          },
          getStr("responsive.deviceAdderTouch")
        ),
        dom.input({
          type: "checkbox",
          defaultChecked: normalizedViewport.touch,
          ref: input => {
            this.touchInput = input;
          },
        })
      ),
      dom.button(
        {
          id: "device-adder-save",
          onClick: this.onDeviceAdderSave,
        },
        getStr("responsive.deviceAdderSave")
      )
    );
  },
});
