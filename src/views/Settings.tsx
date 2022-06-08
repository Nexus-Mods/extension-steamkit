import I18next from 'i18next';
import * as React from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';
import { ComponentEx, More, tooltip, util } from 'vortex-api';

import { setWebApiKey } from '../actions/settings';

interface IBaseProps {
  t: typeof I18next.t;
  onSetSteamWebAPIKey: () => void;
}

interface IConnectedProps {
  WebAPIKey: string;
}

interface IActionProps {
  onResetSteamWebAPIKey: () => void;
}

type IProps = IBaseProps & IConnectedProps & IActionProps;

function renderMore(props: IProps): JSX.Element {
  const { t } = props;
  return (
    <More id='steamkit-reset-api' name={t('Reset Steam Web API Key')}>
      {t('Vortex requires a Steam Web API key In order for Vortex to pull '
       + 'Steam Workshop mods information; this is generated via Steam\'s developer '
       + 'portal.')}
    </More>
  );
}

function resetButton(props: IProps): JSX.Element {
  const { t, onResetSteamWebAPIKey } = props;
  return (
    <div>
      <tooltip.Button
        tooltip={t('Resets the Steam Web API Key')}
        onClick={onResetSteamWebAPIKey}
      >
        {t('Reset Steam Web API Key')}
      </tooltip.Button>
      {renderMore(props)}
    </div>
  );
}

function setButton(props: IProps): JSX.Element {
  const { t, onSetSteamWebAPIKey } = props;
  return (
    <div>
      <tooltip.Button
        tooltip={t('Sets the Steam Web API Key')}
        onClick={onSetSteamWebAPIKey}
      >
        {t('Set Steam Web API Key')}
      </tooltip.Button>
      {renderMore(props)}
    </div>
  );
}

function Settings(props: IProps) {
  const { t, WebAPIKey } = props;
  return (
    <div>
      {WebAPIKey !== undefined ? resetButton(props) : setButton(props)};
    </div>
  );
}

function mapStateToProps(state: any): IConnectedProps {
  return {
    WebAPIKey: util.getSafe(state, ['settings', 'steamkit', 'WebAPIKey'], undefined),
  };
}

function mapDispatchToProps(dispatch: any): IActionProps {
  return {
    onResetSteamWebAPIKey: () => dispatch(setWebApiKey(undefined)),
  };
}

export default
  withTranslation(['common', 'steamkit-settings'])(
    connect(mapStateToProps, mapDispatchToProps)(
      Settings) as any) as React.ComponentClass<IBaseProps>;
