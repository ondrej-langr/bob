import { Command as CommanderCommand } from 'commander';
import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultProgramOptions } from '~/DefaultProgramOptions.js';
import { FileSystem } from '~/FileSystem.js';
import { Project } from '~/Project.js';
import { Workspace } from '~/Workspace.js';

import { Command } from './Command.js';
import { Config, ConfigOptions } from './Config.js';
import { Plugin } from './Plugin.js';
import { BOB_FOLDER_NAME, PACKAGE_RUNTIME_ROOT } from './constants.js';

const COMMANDS_FILE_MATCH = 'commands/*/command.js';

export class Program {
  private commanderProgram: CommanderCommand;
  private plugins: Map<string, Plugin>;
  private commands: Set<Command<any>>;

  private async getCommanderProgram() {
    if (typeof this.commanderProgram === 'undefined') {
      const bobPackage = await Project.loadAt(path.join(PACKAGE_RUNTIME_ROOT, '..'));
      const bobPackageJson = bobPackage.getPackageInfo();

      this.commanderProgram = new CommanderCommand()
        .name(bobPackageJson.name)
        .description(bobPackageJson.description)
        .version(bobPackageJson.version ?? 'unknown')
        .option(
          '-c, --cwd <value>',
          'Define cwd for commands, defaults to cwd that this cli application is executed from',
          (passedValue) => (path.isAbsolute(passedValue) ? passedValue : path.join(process.cwd(), passedValue)),
          process.cwd(),
        )
        .option('-d, --debug', 'If true it enables logging debug messages', false);
    }

    return this.commanderProgram;
  }

  /** Gets project for which current command has been executed */
  async getProject() {
    const program = await this.getCommanderProgram();
    const { cwd } = program.opts<DefaultProgramOptions>();
    let projectOrWorkspace: Project | Workspace | null = null;

    try {
      projectOrWorkspace = await Workspace.loadAt(cwd);
    } catch {
      projectOrWorkspace = await Project.loadAt(cwd).catch(() => null);
    }

    return projectOrWorkspace;
  }

  private async getPlugins() {
    if (typeof this.plugins === 'undefined') {
      const project = await this.getProject();
      const totalConfigPluginsOptions: ConfigOptions['plugins'] = [];

      if (project) {
        const projectBobConfig = await Config.loadAt(project.getRoot());

        if (projectBobConfig) {
          totalConfigPluginsOptions.push(...(projectBobConfig.getOptions().plugins ?? []));
        }

        if (project.workspace) {
          const workspaceBobConfig = await Config.loadAt(project.workspace.getRoot());

          totalConfigPluginsOptions.push(...(workspaceBobConfig?.getOptions().plugins ?? []));
        }
      }
      // TODO: allow user to define plugins with cli arguments

      const resolvedPlugins = await Promise.all(
        totalConfigPluginsOptions.map(
          async (pluginPackageName) => [pluginPackageName, await Plugin.loadAt(pluginPackageName)] as const,
        ),
      );

      this.plugins = new Map(resolvedPlugins);
    }

    return this.plugins;
  }

  private async getCommands() {
    if (typeof this.commands === 'undefined') {
      const plugins = await this.getPlugins();
      const project = await this.getProject();

      const commandsGlobMatches: string[] = [
        // Find commands in plugins
        ...[...plugins.entries()].map(([pluginPackageName]) => {
          const pluginPackageSrcRoot = path.dirname(fileURLToPath(import.meta.resolve(pluginPackageName)));

          return path.join(pluginPackageSrcRoot, COMMANDS_FILE_MATCH);
        }),
      ];

      if (project) {
        // Find commands in current project where command has been executed
        commandsGlobMatches.push(path.join(project.getRoot(), BOB_FOLDER_NAME, COMMANDS_FILE_MATCH));

        // Find commands in workspace if its there
        if (project instanceof Workspace === false && project.workspace) {
          commandsGlobMatches.push(path.join(project.workspace.getRoot(), BOB_FOLDER_NAME, COMMANDS_FILE_MATCH));
        }
      }

      const commandsPathnames = await glob(commandsGlobMatches, {
        absolute: true,
      });

      const commandsAsPromises = commandsPathnames.map(async (commandPathname): Promise<Command<any>> => {
        const command = await import(commandPathname);
        const defaultExport = command && ('default' in command ? command.default : command);
        const hasValidExport = defaultExport && defaultExport instanceof Command;

        if (!hasValidExport) {
          throw new Error(
            `Command at ${commandPathname} has invalid default export. Please use defineCommand function. If it used there are multiple versions of @ondrej-langr/bob package`,
          );
        }

        defaultExport.setProgram(this);

        return defaultExport;
      });
      const resolvedCommands = await Promise.all(commandsAsPromises);
      this.commands = new Set(resolvedCommands.flatMap((commands) => commands));
    }

    return this.commands;
  }

  private async setupCommands() {
    const commands = await this.getCommands();
    const commanderProgram = await this.getCommanderProgram();

    for (const command of commands) {
      commanderProgram
        .command(command.name)
        .description(command.description)
        .action(async () => {
          await command.execute();
        });
    }
  }

  async getOptions() {
    const commanderProgram = await this.getCommanderProgram();

    return commanderProgram.opts<DefaultProgramOptions>();
  }

  async setCwd(newValue: string) {
    const commanderProgram = await this.getCommanderProgram();

    commanderProgram.setOptionValue('cwd', newValue);

    return this;
  }

  async getVersion() {
    const commanderProgram = await this.getCommanderProgram();

    return commanderProgram.version() ?? '0.0.0';
  }

  constructor() {}

  async run() {
    // 1. FIND PLUGINS
    // 2. ATTACH PROGRAM OPTIONS
    // 3. SETUP COMMANDER
    // 4. ATTACH ALL COMMANDS FROM PLUGINS
    // 5. RUN

    await this.setupCommands();

    // Start program
    await this.commanderProgram.parseAsync();

    // TODO: create a local pull request for written files when appropriate action turns that on
    // Commit all files in one go
    await FileSystem.commit();
  }
}