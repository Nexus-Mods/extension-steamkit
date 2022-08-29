import I18next from 'i18next';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { More, tooltip, util } from 'vortex-api';

import { NS } from '../constants';

interface IBaseProps {
  t: typeof I18next.t;
  onSetSteamWebAPIKey: (reset?: boolean) => void;
  getSteamWebApiKey: () => string;
}

type IProps = IBaseProps;

function renderMore(props: IProps): JSX.Element {
  const { t } = useTranslation(NS);
  return (
    <More id='steamkit-reset-api' name={t('Reset Steam Web API Key')}>
      {t('Vortex requires a Steam Web API key In order for Vortex to pull '
       + 'Steam Workshop mods information; this is generated via Steam\'s developer '
       + 'portal.')}
    </More>
  );
}

function resetButton(props: IProps): JSX.Element {
  const { t, onSetSteamWebAPIKey } = props;
  const onResetSteamWebAPIKey = React.useCallback(() => {
    onSetSteamWebAPIKey(true);
  }, [onSetSteamWebAPIKey]);
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
  const onSetKey = React.useCallback(() => {
    onSetSteamWebAPIKey();
  }, [onSetSteamWebAPIKey])
  return (
    <div>
      <tooltip.Button
        tooltip={t('Sets the Steam Web API Key')}
        onClick={onSetKey}
      >
        {t('Set Steam Web API Key')}
      </tooltip.Button>
      {renderMore(props)}
    </div>
  );
}

export default function Settings(props: IProps) {
  const { getSteamWebApiKey } = props;
  const [webAPIKey, setWebApiKey] = React.useState('');
  React.useEffect(() => {
    const fetch = async () => {
      const key = await getSteamWebApiKey();
      setWebApiKey(key);
    };
    // One time deal.
    fetch();
    return () => {
      setWebApiKey('');
    }
  }, []);
  return (
    <div>
      {webAPIKey !== undefined ? resetButton(props) : setButton(props)};
    </div>
  );
}
