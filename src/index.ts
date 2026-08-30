import { ServerAPI, Plugin, Path, PathValue } from '@signalk/server-api'

import { SerialPort } from 'serialport'
import { DelimiterParser} from '@serialport/parser-delimiter'

interface PluginSettings {
  updateRate: number;
  serialDevice: string;
  baudRate: number;
  wgID: string;
  wgName: string;
  pvID: string;
  pvName: string;
}

module.exports = (app: ServerAPI): Plugin => {
  var timer: NodeJS.Timeout | undefined;

  const plugin: Plugin = {
    id: 'signalk-marlec-plugin',
    name: 'Marlec Charge Controller',

    start: (settings: PluginSettings, restartPlugin) => {
      app.debug(`Start settings="${JSON.stringify(settings)}"`)

      setTimer(settings);
    },

    stop: () => {
      app.debug(`Stop`)
      clearTimeout(timer);
      timer = undefined;
    },
    
    schema: {
      type: 'object',
      required: ['updateRate', 'serialPort'], //TODO what does this do?
      properties: {
        updateRate: {
          type: 'number',
          title: 'Seconds between updates - Required',
          default: 5
        },
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

  return plugin;

  function setTimer(settings: PluginSettings) {
    timer = setTimeout(() => {readData(settings);}, settings.updateRate*1000);
  }

  function readData(settings: PluginSettings) {
    var readCount = 0;
    var port = new SerialPort({path: settings.serialDevice, baudRate: settings.baudRate});
    var parser = port.pipe(new DelimiterParser({delimiter: 'WG12000', includeDelimiter: true}));
    parser.on('data', (chunk: Buffer) => {
      // We wait for multiple buffers as the first one may only be partial.
      ++readCount;

      if(readCount > 2) {
        readCount = 0;
        var data = chunk.toString('ascii');
        app.debug(data);

        updateData(settings, data);

        parser.destroy();
        port.close();

        setTimer(settings);
      }
    });
  }

  function parse(item: string, name: string, div: number) {
    if(item.startsWith(name)) {
      item = item.slice(name.length);
      var value = parseInt(item, 10) / div;
      return value;
    }

    return null;
  }

  function updateData(settings: PluginSettings, data: string) {
    var values: PathValue[] = [];

    if(settings.wgID !== undefined && settings.wgName !== undefined) values.push({path: `electrical.windGenerator.${settings.wgID}.name` as Path, value: settings.wgName});
    if(settings.pvID !== undefined && settings.pvName !== undefined) values.push({path: `electrical.solar.${settings.pvID}.name` as Path, value: settings.pvName});

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
  }
}

