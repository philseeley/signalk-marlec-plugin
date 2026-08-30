import { ServerAPI, Plugin, Path, PathValue } from '@signalk/server-api'

import { SerialPort, SerialPortMock } from 'serialport'
import { DelimiterParser} from '@serialport/parser-delimiter'

interface PluginSettings {
  serialDevice: string;
  baudRate: number;
  wgID: string;
  wgName: string;
  pvID: string;
  pvName: string;
}

function parse(item: string, name: string, div: number) {
  if(item.startsWith(name)) {
    item = item.slice(name.length);
    var value = parseInt(item, 10) / div;
    return value;
  }

  return null;
}

var port: SerialPort | undefined;

module.exports = (app: ServerAPI): Plugin => {
  const plugin: Plugin = {
    id: 'signalk-marlec-plugin',
    name: 'Marlec Charge Controller',

    start: (settings: PluginSettings, restartPlugin) => {
      app.debug(`Start settings="${JSON.stringify(settings)}"`)

      port = new SerialPort({path: settings.serialDevice, baudRate: settings.baudRate});
      var parser = port.pipe(new DelimiterParser({delimiter: 'WG12000'}))
      parser.on('data', (chunk: Buffer) => {
        var data = chunk.toString('ascii');app.debug(data);
        // var deltas: Map<string, any>[] = [];
        var values: PathValue[] = [];

        for(const item of data.split(' ')) {
          var value;
          if(settings.wgID !== undefined) {
            value = parse(item, 'WGV', 100);
            if(value !== null) { values.push({path: `electrical.windGenerator.${settings.wgID}.voltage` as Path, value: value}); continue; };
            value = parse(item, 'WGI', 100);
            if(value !== null) { values.push({path: `electrical.windGenerator.${settings.wgID}.current` as Path, value: value}); continue; };
            value = parse(item, 'WGon', 1);
            if(value !== null) { values.push({path: `electrical.windGenerator.${settings.wgID}.state` as Path, value: {code: value, message: value===0?'off':'on'}}); continue; };
          }

          if(settings.pvID !== undefined) {
            value = parse(item, 'PVV', 100);
            if(value !== null) { values.push({path: `electrical.solar.${settings.pvID}.voltage` as Path, value: value}); continue; };
            value = parse(item, 'PVI', 100);
            if(value !== null) { values.push({path: `electrical.solar.${settings.pvID}.current` as Path, value: value}); continue; };
            value = parse(item, 'PVon', 1);
            if(value !== null) { values.push({path: `electrical.solar.${settings.pvID}.state` as Path, value: {code: value, message: value===0?'off':'on'}}); continue; };
          }
        }

        app.debug(values);

        app.handleMessage(plugin.id, {
            updates: [{
              values: values
            }]
          })
      })
    },

    stop: () => {
      app.debug(`Stop`)
      port?.close();
      port = undefined;
    },
    
    schema: {
      type: 'object',
      required: ['serialPort'], //TODO what does this do?
      properties: {
        serialDevice: {
          type: 'string',
          title: 'The USB serial port device - Required',
          default: '/dev/ttyUSB0'
        },
        baudRate: {
          type: 'number',
          title: 'The USB serial port baud rate - Required',
          default: 115200
        },
        wgID: {
          type: 'string',
          title: 'ID of the Wind Generator - leave blank if no WG fitted'
        },
        wgName: {
          type: 'string',
          title: 'Name of the Wind Generator',
        },
        pvID: {
          type: 'string',
          title: 'ID of the Solar Panel - leave blank if no Solar Panel fitted'
        },
        pvName: {
          type: 'string',
          title: 'Name of the Solar Panel',
        },
      }
    }
  }

  return plugin
}

