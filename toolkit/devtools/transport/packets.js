/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Packets contain read / write functionality for the different packet types
 * supported by the debugging protocol, so that a transport can focus on
 * delivery and queue management without worrying too much about the specific
 * packet types.
 *
 * They are intended to be "one use only", so a new packet should be
 * instantiated for each incoming or outgoing packet.
 *
 * A complete Packet type should expose at least the following:
 *   * read(stream):  Called when the input stream has data to read
 *   * write(stream): Called when the output stream is ready to write
 *   * get done():    Returns true once the packet is done being read / written
 *   * destroy():     Called to clean up at the end of use
 */

let { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});

let Heritage = devtools.require("sdk/core/heritage");

let unicodeConverter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                       .createInstance(Ci.nsIScriptableUnicodeConverter);
unicodeConverter.charset = "UTF-8";

/**
 * A generic Packet processing object (extended by two subtypes below).
 */
function Packet(transport) {
  this._transport = transport;
  this._segments = [];
}

Packet.prototype = {

  read: function(stream) {
    let incomingSegment;

    for (let segment of this._segments) {
      if (!segment.done) {
        incomingSegment = segment;
        break;
      }
    }

    if (incomingSegment) {
      incomingSegment.read(stream);
    }
  },

  write: function(stream) {
    let outgoingSegment;

    for (let segment of this._segments) {
      if (!segment.done) {
        outgoingSegment = segment;
        break;
      }
    }

    if (outgoingSegment) {
      outgoingSegment.write(stream);
    }
  },

  get done() {
    return this._segments.every(seg => seg.done);
  },

  destroy: function() {
    this._transport = null;
    for (let segment of this._segments) {
      segment.destroy();
    }
  }

};

/**
 * With a JSON packet (the typical packet type sent via the transport), data is
 * transferred as a JSON packet serialized into a string, with the string length
 * prepended to the packet, followed by a colon ([length]:[packet]). The
 * contents of the JSON packet are specified in the Remote Debugging Protocol
 * specification.
 */
function JSONPacket(transport) {
  Packet.call(this, transport);
  this._initSegments();
}

JSONPacket.prototype = Heritage.extend(Packet.prototype, {

  _initSegments: function() {
    this._lengthSegment = new DelimitedSegment(":");
    this._dataSegment = new StringSegment();
    this._segments = [
      this._lengthSegment,
      this._dataSegment
    ];
  },

  /**
   * Gets the object (not the serialized string) being read or written.
   */
  get object() { return this._object; },

  /**
   * Sets the object to be sent when write() is called.
   */
  set object(object) {
    this._object = object;
    let json = JSON.stringify(object);
    json = unicodeConverter.ConvertFromUnicode(json);
    this._lengthSegment.data = json.length;
    this._dataSegment.data = json;
  },

  /**
   * For JSON packets, there is no "true" type marker used, to avoid breaking
   * backward compatibility.  A few bytes must be read to check the incoming
   * packet type, and in the case of a JSON packet, they are part of the actual
   * packet data, so that is passed in here after creation time.
   * @see packetFactory.fromType
   */
  readInitial: function(initialData) {
    this._initialData = initialData;
  },

  read: function(stream) {
    // Read the length if we don't have it yet.
    if (!this._length) {
      this._readLength(stream);
      return;
    }

    // Read in more packet data.
    this._dataSegment.read(stream, this._length);

    if (!this.done) {
      // Don't have a complete packet yet.
      return;
    }

    let json = this._dataSegment.data;
    try {
      json = unicodeConverter.ConvertToUnicode(json);
      this._object = JSON.parse(json);
    } catch(e) {
      let msg = "Error parsing incoming packet: " + json + " (" + e +
                " - " + e.stack + ")";
      if (Cu.reportError) {
        Cu.reportError(msg);
      }
      dumpn(msg);
      return;
    }

    this._transport._onJSONObjectReady(this._object);
  },

  _readLength: function(stream) {
    // Don't keep reading forever if the length field is unreasonably long.
    this._lengthSegment.limit = 20;

    let remainingData = this._lengthSegment.readInitial(this._initialData);
    this._lengthSegment.read(stream);

    let lengthString = this._lengthSegment.data;
    // Check for a positive number with no garbage afterwards.
    if (!/^[0-9]+$/.exec(lengthString)) {
      throw new Error("Invalid packet length field.");
    }

    this._length = +lengthString;
    this._dataSegment.data = remainingData;
  },

  write: function(stream) {
    dumpv(() => "Writing JSON packet");
    Packet.prototype.write.call(this, stream);
  },

  toString: function() {
    return JSON.stringify(this._object, null, 2);
  }

});

this.JSONPacket = JSONPacket;

/**
 * With a bulk packet, data is transferred by temporarily handing over the
 * transport's input or output stream to the application layer for writing data
 * directly.  This can be much faster for large data sets, and avoids various
 * stages of copies and data duplication inherent in the JSON packet type.  The
 * bulk packet looks like:
 *
 * bulk [actor] [type] [length]:[data]
 *
 * The data portion is application-defined and does not follow any one
 * specification.  See the Remote Debugging Protocol Stream Transport spec for
 * more details.
 */
function BulkPacket(transport) {
  Packet.call(this, transport);
  this._initSegments();
}

BulkPacket.prototype = Heritage.extend(Packet.prototype, {

  _initSegments: function() {
    let bulkSegment = new DelimitedSegment(" ");
    bulkSegment.data = "bulk";
    this._actorSegment = new DelimitedSegment(" ");
    this._typeSegment = new DelimitedSegment(" ");
    this._lengthSegment = new DelimitedSegment(":");
    this._streamSegment = new StreamSegment(this);
    this._segments = [
      bulkSegment,
      this._actorSegment,
      this._typeSegment,
      this._lengthSegment,
      this._streamSegment
    ];
  },

  read: function(stream) {
    dumpv(() => "Reading bulk packet");
    Packet.prototype.read.call(this, stream);
  },

  write: function(stream) {
    dumpv(() => "Writing bulk packet");
    Packet.prototype.write.call(this, stream);
  },

  get streamReadyForWriting() {
    return this._streamSegment.readyForWriting;
  },

  get actor() { return this._actorSegment.data; },

  set actor(actor) { this._actorSegment.data = actor; },

  get type() { return this._typeSegment.data; },

  set type(type) { this._typeSegment.data = type; },

  get length() { return this._lengthSegment.data; },

  set length(length) {
    this._lengthSegment.data = length;
    this._streamSegment.length = length;
  },

  get header() {
    return {
      actor: this.actor,
      type: this.type,
      length: this.length
    };
  },

  set header(header) {
    this.actor = header.actor;
    this.type = header.type;
    this.length = header.length;
  },

  toString: function() {
    return "Bulk: " + JSON.stringify(this.header, null, 2);
  }

});

this.BulkPacket = BulkPacket;

/**
 * Helper factory for creating the right packet object.
 */
let packetFactory = {

  fromType: function(packetType, transport) {
    let packet;
    if (packetType === "bulk") {
      packet = new BulkPacket(transport);
    } else {
      packet = new JSONPacket(transport);
      // The "packet type" is really the first bits of the real packet in
      // this case, since there is no type identifier.
      packet.readInitial(packetType);
    }
    return packet;
  }

};

this.packetFactory = packetFactory;
