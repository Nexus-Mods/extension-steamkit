/* eslint-disable max-lines-per-function */
import path from 'path';

import { EmptyPlaceholder, FlexLayout, FormInput, MainContext,
  IconBar, MainPage, selectors, Spinner, types, util, Dropdown, DropdownButton } from 'vortex-api';

import { useSelector } from 'react-redux';
import Select from 'react-select';

import * as React from 'react';
import { InputGroup, Panel } from 'react-bootstrap';
import { IWorkshopMod } from '../types/interface';
import ModThumbnail from './ModThumbnail';
import { useTranslation } from 'react-i18next';
import { TFunction } from 'i18next';

import { setWorkshopModFilter } from '../actions/session';
import { ModScrubber, QueryType } from '../util/Scrubber';
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

export default function WorkshopPage(props: IBaseProps) {
  const { onGameModeActivated, onModClick } = props;
  const [ t ] = useTranslation();
  const [ availableMods, setAvailableMods ] = React.useState([]);
  const [ page, setPage ] = React.useState(1);
  const [ modScrubber, setModScrubber ] = React.useState<ModScrubber | undefined>(undefined);
  const [ counter, setCounter ] = React.useState(0);
  const [ loading, setLoading ] = React.useState<boolean>(false);
  const [ sorting, setSorting ] = React.useState(QueryType.ByDate);
  const [ currentFilterValue, setCurrentFilterValue ] = React.useState('');
  const { gameMode, fallbackImg } = useSelector<any, IConnectedProps>(mapStateToProps);
  const context = React.useContext(MainContext);
  const { onSetWorkshopModFilter } = mapDispatchToProps(context.api.store.dispatch);
  const onSetPage = React.useCallback((updatePage: (oldPage: number) => number) => {
    if (!modScrubber) {
      return;
    }
    const newPage = updatePage(page);
    if ((newPage !== page) && (newPage > 0) && (newPage <= Math.ceil(modScrubber.availableTotal() / MODS_PER_PAGE))) {
      setAvailableMods([]);
      setPage(newPage);
    }
  }, [page, setPage, setAvailableMods, modScrubber]);

  const incrementCounter = React.useCallback(() => {
    setAvailableMods([]);
    setCounter(oldValue => oldValue + 1);
  }, [setCounter, setAvailableMods]);

  const buttons = React.useMemo<Array<types.IActionDefinition>>(() => {
    return [
      { action: () => onSetPage(old => old - 1), title: 'Previous Page', icon: 'nav-back' },
      { action: () => onSetPage(old => old + 1), title: 'Next Page', icon: 'nav-forward' },
    ];
  }, [onSetPage]);

  const applyFilter = React.useCallback((value) => {
    setCurrentFilterValue(value);
    onSetWorkshopModFilter(value);
    modScrubber?.resetDataArray?.();
    incrementCounter();
    onSetPage(() => 1);
  }, [
    onSetPage, setCurrentFilterValue,
    onSetWorkshopModFilter, modScrubber,
  ]);

  const onSetSorting = React.useCallback((selection: { value: any, label: string }) => {
    setSorting(selection.value);
    modScrubber?.resetDataArray?.();
    incrementCounter();
    onSetPage(() => 1);
  }, [setSorting, incrementCounter, onSetPage]);

  React.useEffect(() => {
    const fetchModScrubber = async () => {
      if (gameMode) {
        try {
          const scrubber = await onGameModeActivated(gameMode);
          // scrubber may be undefined if the game is not a steam game
          setModScrubber(scrubber);
          incrementCounter();
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
      setLoading(true);
      const mods = await modScrubber.scrubPage({
        page,
        filter: currentFilterValue,
        sorting,
      });
      setLoading(false);
      if (mods?.length > 0) {
        setAvailableMods(mods);
        setPage(page);
      }
    };
    updatePage();
  }, [page, counter, sorting]);

  return (
    <MainPage>
      <MainPage.Header>
        <IconBar
          group='workshop-icons'
          staticElements={buttons}
          className='menubar'
          t={t}
        />
        <InputGroup>
          <FormInput
            className='mod-filter-input'
            value={currentFilterValue}
            placeholder={t('Search for a mod (title or description)...')}
            onChange={applyFilter}
            debounceTimer={1000}
            clearable
          />
        </InputGroup>
        <Select
          options={[
            { value: QueryType.ByDate, label: t('Newest') },
            { value: QueryType.ByVote, label: t('Highest Rated') },
            { value: QueryType.ByTrend, label: t('Trending') },
          ]}
          value={sorting}
          onChange={onSetSorting}
          clearable={false}
          // autosize={false}
          searchable={false}
        />
      </MainPage.Header>
      <MainPage.Body>
        <FlexLayout type='column' className='mod-page'>
          <FlexLayout.Fixed>
            <Panel className='mod-filter-container'>
              <Panel.Body>
              </Panel.Body>
            </Panel>
          </FlexLayout.Fixed>
          <FlexLayout.Flex>
            <Panel className='modpicker-body'>
              <Panel.Body>
                <WorkshopModsMods
                  t={t}
                  loading={loading}
                  fallbackImg={fallbackImg}
                  mods={availableMods}
                  onModClick={onModClick}
                />
              </Panel.Body>
            </Panel>
          </FlexLayout.Flex>
        </FlexLayout>
      </MainPage.Body>
    </MainPage>
  );
}

interface IModsProps {
  t: TFunction;
  loading: boolean;
  mods: IWorkshopMod[];
  onModClick: (mod: IWorkshopMod) => void;
  fallbackImg: string;
}
function WorkshopModsMods(props: IModsProps) {
  const { t, loading, mods, onModClick, fallbackImg } = props;
  
  if (loading) {
    return (<RenderWait/>);
  }

  return mods.length > 0
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
    <EmptyPlaceholder
      icon='steam'
      text={t('No more mods')}
      fill={true}
    />
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
