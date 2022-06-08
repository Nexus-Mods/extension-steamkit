export class NoSteamDataException extends Error {
  constructor() {
    super('Workshop mods are not available for this game');
  }
}
