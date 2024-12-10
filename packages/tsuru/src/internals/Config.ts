import { cosmiconfig } from 'cosmiconfig';

import { TSURU_FOLDER_NAME } from './constants.js';

export type ConfigOptions = {
  /** Defines plugin package names that current project uses. If Tsuru is executed in project inside workspace project it will inherit those configurations */
  plugins?: string[] | undefined;
};

const cosmiconfigModuleName = 'tsuru';
const cosmiconfigSearchPlaces = [
  `${TSURU_FOLDER_NAME}/config.js`,
  `${TSURU_FOLDER_NAME}/config.ts`,
  `${TSURU_FOLDER_NAME}/config.mjs`,
];

export class Config {
  private options: ConfigOptions;
  constructor(options: ConfigOptions) {
    this.options = options;
  }

  getOptions() {
    return this.options;
  }

  static async loadAt(projectRoot: string) {
    const configExplorer = cosmiconfig(cosmiconfigModuleName, {
      searchPlaces: cosmiconfigSearchPlaces,
      stopDir: projectRoot,
    });

    const result = await configExplorer.search(projectRoot);

    if (!result) {
      return null;
    }

    const { config } = result;
    const defaultExport =
      config && ('default' in config ? config.default : config);
    const hasValidExport =
      defaultExport && defaultExport instanceof Config;

    return hasValidExport ? defaultExport : null;
  }
}
