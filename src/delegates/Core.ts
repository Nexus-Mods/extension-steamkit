import { types } from 'vortex-api';
import Context from './Context';
import UI from './UI';

export class Core {
  public context: Context;
  public ui: UI;

  constructor(api: types.IExtensionApi, gameId: string) {
    this.ui = new UI(api, gameId);
    this.context = new Context(api, gameId);
  }

  public detach() {
    this.ui.detach();
    this.context.detach();
  }
}

export default Core;
