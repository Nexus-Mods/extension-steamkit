import path from 'path';

import { ComponentEx, EmptyPlaceholder, FlexLayout, FormInput, Icon,
  IconBar, MainPage, selectors, tooltip, types, util } from 'vortex-api';

import { connect } from 'react-redux';

import { TFunction } from 'i18next';

import Promise from 'bluebird';
import * as React from 'react';
import { FormControl, InputGroup, ListGroup,
         Panel, PanelGroup, ProgressBar } from 'react-bootstrap';
import { IWorkshopMod } from '../types/interface';
import ModThumbnail from './ModThumbnail';

interface IBaseProps {
  t: TFunction;
  onRefreshWorkshopMods: (gameId: string, page: number) => Promise<IWorkshopMod[]>;
  onModClick: (mod: IWorkshopMod) => void;
  onGetPage: (page: number) => Promise<number>;
}

interface IConnectedProps {
  profiles: { [profileId: string]: types.IProfile };
  gameMode: string;
  totalMods: number;
  fallbackImg: string;
}

type IProps = IBaseProps & IConnectedProps;

interface IComponentState {
  currentFilterValue: string;
  availableMods: IWorkshopMod[];
  currentPage: number;
}

function nop() {
  // nop
}

class WorkshopPage extends ComponentEx<IProps, IComponentState> {
  public declare context: types.IComponentContext;

  private buttons: types.IActionDefinition[];
  private mRef: HTMLElement;

  constructor(props: IProps) {
    super(props);

    this.initState({
      availableMods: [],
      currentFilterValue: '',
      currentPage: 1,
    });

    this.buttons = [
      { action: () => this.prevPage(), title: 'Previous Page' },
      { action: () => this.nextPage(), title: 'Next Page' },
      { action: () => this.props.onRefreshWorkshopMods(this.props.gameMode, 1), title: 'Refresh Mods' },
    ];
  }

  public componentDidMount(): void {
    this.updateMods(this.state.currentPage);
  }

  public shouldComponentUpdate(nextProps: IProps, nextState: IComponentState): boolean {
    if ((this.props.totalMods !== nextProps.totalMods)
      || this.state.currentPage !== nextState.currentPage) {
        return true;
    }
    return false;
  }

  public componentDidUpdate(prevProps: IProps, prevState: IComponentState, snapshot?: any): void {
    if (this.props.totalMods !== prevProps.totalMods) {
      this.updateMods(this.state.currentPage);
    }
  }

  public render(): JSX.Element {
    const { t, profiles } = this.props;
    const { currentFilterValue, availableMods } = this.state;

    return (
      <MainPage domRef={this.setRef}>
        <MainPage.Header>
          <IconBar
            group='workshop-icons'
            staticElements={this.buttons}
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
                  onChange={this.onFilterInputChange}
                  debounceTimer={100}
                  clearable
                />
              </InputGroup>
            </FlexLayout.Fixed>
            <FlexLayout.Flex>
              <div className='modpicker-body'>
                <PanelGroup id='mod-panel-group'>
                    <Panel.Body>
                      {this.renderMods(availableMods)}
                    </Panel.Body>
                </PanelGroup>
              </div>
            </FlexLayout.Flex>
          </FlexLayout>
        </MainPage.Body>
      </MainPage>
    );
  }

  private nextPage = async () => {
    const wantedPage = this.state.currentPage + 1;
    const hasPage = await this.props.onGetPage(wantedPage);
    if (hasPage) {
      this.nextState.currentPage = wantedPage;
      this.updateMods(wantedPage);
    }
  }

  private prevPage = async () => {
    const wantedPage = this.state.currentPage - 1;
    const hasPage = await this.props.onGetPage(wantedPage);
    if (hasPage) {
      this.nextState.currentPage = wantedPage;
      this.updateMods(wantedPage);
    }
  }

  private updateMods = async (page: number) => {
    const mods: IWorkshopMod[] = await this.props.onRefreshWorkshopMods(this.props.gameMode, page);
    this.nextState.availableMods = mods;
  }

  private onFilterInputChange = (input) => {
    this.nextState.currentFilterValue = input;
  }

  private applyModFilter = (mod: IWorkshopMod): boolean => {
    const { currentFilterValue } = this.state;
    return mod.title.toLowerCase().includes(currentFilterValue.toLowerCase())
        || !currentFilterValue;
  }

  private setRef = ref => {
    this.mRef = ref;
  }

  private renderMods = (mods: IWorkshopMod[]): JSX.Element => {
    const { t, gameMode } = this.props;
    const { currentFilterValue } = this.state;

    if (mods?.length === 0) {
      if (!!(currentFilterValue)) {
        return null;
      } else {
        return (
          <EmptyPlaceholder
            icon='game'
            text={t('There are no mods to choose from')}
            subtext={t('Click the refresh button')}
          />
        );
      }
    }
    return this.renderModsSmall(mods, gameMode);
  }

  private renderModsSmall(mods: IWorkshopMod[], gameMode: string) {
    const { t } = this.props;

    return (
      <div>
        <div className='mods-group'>
          {mods.map(mod => (
            <ModThumbnail
              t={t}
              key={mod.publishedfileid}
              mod={mod}
              onModClick={this.props.onModClick}
              fallbackImg={this.props.fallbackImg}
            />
          ))
          }
        </div>
      </div>
    );
  }
}

function mapStateToProps(state: any): IConnectedProps {
  const gameMode = selectors.activeGameId(state);
  const game = selectors.gameById(state, gameMode);
  return {
    gameMode,
    fallbackImg: path.join(game.extensionPath, game.logo),
    profiles: state.persistent.profiles,
    totalMods: util.getSafe(state, ['session', 'steamkit', 'cache', gameMode, 'totalMods'], 0),
  };
}

function mapDispatchToProps(dispatch): any {
  return {};
}

export default
  connect(mapStateToProps, mapDispatchToProps)(WorkshopPage);
