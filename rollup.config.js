import babel from 'rollup-plugin-babel';
import pkg from './package.json';

export default [
  {
    input: pkg.module,
    output: [
      { file: pkg.bin['gps'], format: 'cjs', sourcemap: true },
    ],
    external: [
      'debug',
      'amqplib',
      'serialport',
      'redis',
      '@mark48evo/usb-serialport-device-lister',
      '@mark48evo/ubx-protocol-parser',
      '@mark48evo/ubx-packet-parser',
      '@mark48evo/rabbitmq-pubsub',
      '@mark48evo/system-events',
      '@mark48evo/system-state',
      '@mark48evo/system-gps',
    ],
    plugins: [
      babel({
        exclude: 'node_modules/**',
        envName: 'rollup',
      }),
    ],
  },
];
