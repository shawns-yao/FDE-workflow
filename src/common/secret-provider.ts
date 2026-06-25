export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
  require(name: string): Promise<string>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  async get(name: string): Promise<string | undefined> {
    return process.env[name];
  }

  async require(name: string): Promise<string> {
    const value = await this.get(name);
    if (!value) {
      throw new Error(`Missing required secret: ${name}`);
    }
    return value;
  }
}
