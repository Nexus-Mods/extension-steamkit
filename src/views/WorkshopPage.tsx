/* eslint-disable max-lines-per-function */
import path from 'path';

import { EmptyPlaceholder, FlexLayout, FormInput, MainContext,
  IconBar, MainPage, selectors, Spinner, types, util } from 'vortex-api';

import { useSelector } from 'react-redux';

import * as React from 'react';
import { InputGroup, Panel, PanelGroup } from 'react-bootstrap';
import { IWorkshopMod } from '../types/interface';
import ModThumbnail from './ModThumbnail';
import { useTranslation } from 'react-i18next';
import { TFunction } from 'i18next';

import { setWorkshopModFilter } from '../actions/session';
import { ModScrubber } from '../util/Scrubber';
import { MODS_PER_PAGE } from '../constants';

interface IBaseProps {
  api: types.IExtensionApi;
  onGameModeActivated: (gameId: string) => Promise<ModScrubber>;
  onModClick: (mod: IWorkshopMod) => void;
}

interface IConnectedProps {
  gameMode: string;
  totalMods: number;
  fallbackImg: string;
}

interface IActionProps {
  onSetWorkshopModFilter: (filter: string) => void;
}

const initialState = {

};

export default function WorkshopPage(props: IBaseProps) {
  const { onGameModeActivated, onModClick } = props;
  const [ t ] = useTranslation();
  const [ availableMods, setAvailableMods ] = React.useState([]);
  const [ page, setPage ] = React.useState(1);
  const [ modScrubber, setModScrubber ] = React.useState<ModScrubber | undefined>(undefined);
  const [ counter, setCounter ] = React.useState(0);
  const [ currentFilterValue, setCurrentFilterValue ] = React.useState('');
  const { gameMode, fallbackImg } = useSelector(mapStateToProps);
  const context = React.useContext(MainContext);
  const { onSetWorkshopModFilter } = mapDispatchToProps(context.api.store.dispatch);
  const onSetPage = React.useCallback((newPage: number) => {
    if (!modScrubber) {
      return;
    }
    if (newPage !== page && newPage > 0 && newPage <= Math.ceil(modScrubber.availableTotal() / MODS_PER_PAGE)) {
      setAvailableMods([]);
      setPage(newPage);
    }
  }, [page, setPage, setAvailableMods, modScrubber]);

  const onSetCounter = React.useCallback((newCounter: number) => {
    if (newCounter !== counter) {
      setAvailableMods([]);
      setCounter(newCounter);
    }
  }, [counter, setCounter, setAvailableMods]);

  const buttons = React.useMemo(() => {
    return [
      { action: () => onSetPage(page - 1), title: 'Previous Page' },
      { action: () => onSetPage(page + 1), title: 'Next Page' },
    ];
  }, [page, onSetPage]);

  const applyFilter = React.useCallback((value) => {
    setCurrentFilterValue(value);
    onSetWorkshopModFilter(value);
    if (modScrubber) {
      modScrubber.resetDataArray();
    }
    onSetCounter(counter + 1);
    onSetPage(1);
  }, [
    onSetPage, onSetCounter, setCurrentFilterValue,
    onSetWorkshopModFilter, modScrubber, counter,
  ]);

  React.useEffect(() => {
    const fetchModScrubber = async () => {
      if (gameMode) {
        try {
          const scrubber = await onGameModeActivated(gameMode);
          if (!scrubber) {
            throw new Error('Steam Mod Scrubber could not be initialized');
          }
          setModScrubber(scrubber);
          onSetCounter(counter + 1);
        } catch (err) {
          context.api.showErrorNotification('Failed to load mod scrubber', err);
        }
      }
    }
    fetchModScrubber();
  } ,[gameMode]);
  React.useEffect(() => {
    if (!modScrubber) {
      return;
    }
    const updatePage = async () => {
      const mods = await modScrubber.scrubPage({
        page,
        filter: currentFilterValue
      });
      if (mods?.length > 0) {
        setAvailableMods(mods);
        setPage(page);
      }
    };
    updatePage();
  }, [page, counter]);

  return (
    <MainPage>
      <MainPage.Header>
        <IconBar
          group='workshop-icons'
          staticElements={buttons}
          className='menubar'
          t={t}
        />
      </MainPage.Header>
      <MainPage.Body>
        <FlexLayout type='column' className='mod-page'>
          <FlexLayout.Fixed>
            <InputGroup>
              <FormInput
                className='mod-filter-input'
                value={currentFilterValue}
                placeholder={t('Search for a mod...')}
                onChange={applyFilter}
                debounceTimer={1000}
                clearable
              />
            </InputGroup>
          </FlexLayout.Fixed>
          <FlexLayout.Flex>
            <div className='modpicker-body'>
              <PanelGroup id='mod-panel-group'>
                  <Panel.Body>
                    <WorkshopModsMods
                      t={t}
                      fallbackImg={fallbackImg}
                      mods={availableMods}
                      onModClick={onModClick}
                    />
                  </Panel.Body>
              </PanelGroup>
            </div>
          </FlexLayout.Flex>
        </FlexLayout>
      </MainPage.Body>
    </MainPage>
  );
}

interface IModsProps {
  t: TFunction
  mods: IWorkshopMod[];
  onModClick: (mod: IWorkshopMod) => void;
  fallbackImg: string;
}
function WorkshopModsMods(props: IModsProps) {
  const { t, mods, onModClick, fallbackImg } = props;
  return mods?.length > 0 
    ? (
    <div className='mods-group'>
      {
        mods.map(mod =>
          <ModThumbnail
            t={t}
            key={mod.publishedfileid}
            mod={mod}
            onModClick={onModClick}
            fallbackImg={fallbackImg}
          />
        )
      }
    </div>
  ) : (
    <RenderWait />
  );
}

function RenderWait() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
      }}
    >
      <Spinner
        style={{
          width: '64px',
          height: '64px',
        }}
      />
    </div>
  );
}

function mapStateToProps(state: any): IConnectedProps {
  const gameMode = selectors.activeGameId(state);
  if (!gameMode) {
    return { gameMode, totalMods: 0, fallbackImg: '' };
  }
  const game = selectors.gameById(state, gameMode);
  return {
    gameMode,
    fallbackImg: (game?.extensionPath && game?.logo)
      ? path.join(game.extensionPath, game.logo)
      : path.join(__dirname, 'steam.jpg'),
    totalMods: util.getSafe(state, ['session', 'steamkit', 'cache', gameMode, 'totalMods'], 0),
  };
}

function mapDispatchToProps(dispatch: any): IActionProps {
  return {
    onSetWorkshopModFilter: (filter: string) => dispatch(setWorkshopModFilter(filter)),
  };
}
