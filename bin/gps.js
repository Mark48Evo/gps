'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Debug = _interopDefault(require('debug'));
var amqplib = _interopDefault(require('amqplib'));
var SerialPort = _interopDefault(require('serialport'));
var redis = require('redis');
var UsbSerialPortDeviceLister = _interopDefault(require('@mark48evo/usb-serialport-device-lister'));
var UBXProtocolParser = _interopDefault(require('@mark48evo/ubx-protocol-parser'));
var UBXPacketParser = _interopDefault(require('@mark48evo/ubx-packet-parser'));
var SystemEvents = _interopDefault(require('@mark48evo/system-events'));
var SystemState = _interopDefault(require('@mark48evo/system-state'));
var SystemGPS = _interopDefault(require('@mark48evo/system-gps'));

async function main() {
  const debug = Debug('gps');
  const config = {
    rabbitmqHost: process.env.RABBITMQ_HOST || 'amqp://localhost',
    redisURL: process.env.REDIS_URL || 'redis://127.0.0.1:6379/3'
  };

  const serialPortError = err => {
    console.error(`SerialPort Error: ${err}`);
  };

  const rabbitmqConnect = await amqplib.connect(config.rabbitmqHost);
  const rabbitmqChannel = await rabbitmqConnect.createChannel();
  const redis$$1 = redis.createClient(config.redisURL);
  const systemEvents = await SystemEvents(rabbitmqChannel, {
    consume: false
  });
  const systemState = await SystemState(redis$$1, rabbitmqChannel, {
    consume: false
  });
  const systemGPS = await SystemGPS(rabbitmqChannel, {
    consume: false
  });
  const usbListener = new UsbSerialPortDeviceLister({
    filters: [{
      vendorId: '1546',
      productId: '01a8'
    }]
  });

  const resetGPSState = () => {
    systemState.set('gps.usb.found', false);
    systemState.set('gps.usb.connected', false);
    systemState.set('gps.nav.fix', 'no gps');
    systemState.set('gps.nav.sats', []);
    systemState.set('gps.nav.sats.count', 0);
  };

  const ubxProtocolParser = new UBXProtocolParser();
  const ubxPacketParser = new UBXPacketParser();
  let previousFix;

  const parseNavStatus = packet => {
    if (packet.data.gpsFix.string !== previousFix) {
      previousFix = packet.data.gpsFix.string;
      systemState.set('gps.nav.fix', previousFix);
    }

    systemGPS.publish('nav.status', packet);
  };

  let previousSatCount = 0;

  const parseNavSat = packet => {
    const connectedSats = packet.data.sats.filter(sat => {
      return sat.flags.qualityInd.raw >= 4;
    });

    if (connectedSats.length !== previousSatCount) {
      previousSatCount = connectedSats.length;
      const sats = connectedSats.map(sat => {
        return {
          gnss: sat.gnss.string,
          satelliteId: sat.svId,
          signalHealth: sat.flags.health.string,
          signalStrength: sat.cno
        };
      });
      systemState.set('gps.nav.sats', sats);
      systemState.set('gps.nav.sats.count', previousSatCount);
    }

    systemGPS.publish('nav.sat', packet);
  };

  const parseNavPvt = packet => {
    systemGPS.publish('nav.pvt', packet);
  };

  ubxProtocolParser.pipe(ubxPacketParser);
  ubxPacketParser.on('data', data => {
    switch (data.type) {
      case 'NAV-STATUS':
        parseNavStatus(data);
        break;

      case 'NAV-SAT':
        parseNavSat(data);
        break;

      case 'NAV-PVT':
        parseNavPvt(data);
        break;

      default:
        debug(`Received unhandled packet type: "${data.type}"`);
        break;
    }
  });
  usbListener.on('attach', device => {
    debug(`GPS Device found at "${device.comName}"`);
    systemEvents.publish('gps.usb.connected', device);
    systemState.set('gps.usb.found', true);
    const serialPort = new SerialPort(device.comName, {
      baudRate: 921600,
      autoOpen: false
    });
    serialPort.on('error', err => {
      serialPortError(err);
    });
    serialPort.open(err => {
      if (err) {
        return serialPortError(err);
      }

      systemState.set('gps.usb.connected', true);
      return serialPort.pipe(ubxProtocolParser);
    });
  });
  usbListener.on('detach', device => {
    debug(`GPS Device disconnected at "${device.comName}"`);
    systemEvents.publish('gps.usb.disconnected', device);
    resetGPSState();
  });
  resetGPSState();
  usbListener.start();
}

main().catch(e => console.error(e));
//# sourceMappingURL=gps.js.map
