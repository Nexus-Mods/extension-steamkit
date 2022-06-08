import { ComponentEx, EmptyPlaceholder, selectors, types, util } from 'vortex-api'; 
import { connect } from 'react-redux';
import Promise from 'bluebird';
import { TFunction } from 'i18next';
import * as React from 'react';

import { IWorkshopMod, IWorkshopModInfo } from '../types/interface';

export interface IBaseProps {
  t: TFunction;
  mod: IWorkshopMod;
  onRefreshModInfo: (mod: IWorkshopMod) => Promise<void>;
  onGameChange: () => Promise<void>;
}

interface IConnectedProps {
  activeGameId: string;
  language: string;
}

type IProps = IBaseProps & IConnectedProps;

class ModInfoPopover extends ComponentEx<IProps, { loading: boolean }> {
  private mMounted: boolean = false;
  constructor(props: IProps) {
    super(props);
    this.state = { loading: false };
  }

  public componentDidMount() {
    const { mod, onRefreshModInfo } = this.props;
    this.mMounted = true;
    if (onRefreshModInfo !== undefined) {
      this.setState({ loading: true });
      onRefreshModInfo(mod)
        .then(() => {
          if (this.mMounted) {
            this.setState({ loading: false });
          }
        });
    }
  }

  public componentWillUnmount() {
    this.mMounted = false;
  }

  public UNSAFE_componentWillReceiveProps(nextProps: IProps) {
    // if ((this.props.activeGameId !== nextProps.activeGameId)
    //   && (nextProps.onRefreshGameInfo !== undefined)) {
    //   nextProps.onRefreshGameInfo(nextProps.game.id);
    // }

    // if (this.props.gameInfo !== nextProps.gameInfo) {
    //   nextProps.onChange();
    // }
  }

  public render(): JSX.Element {
    const { t, mod } = this.props;
    const keysToRender = Object.keys(mod)
      .filter(key => mod[key] !== null);

    if (keysToRender.length === 0) {
      return (
        <EmptyPlaceholder icon='layout-list' text={t('No Information about this mod')} />
      );
    }

    return (
      <div className='mod-info-grid'>
        {keysToRender.map(this.renderModInfo)}
      </div>
    );
  }

  private renderModInfo = (key: string) => {
    const { t, mod } = this.props;
    return [
      <div key={`${key}-title`} className='game-info-title'>{t(mod.title)}</div>,
      (
        <div key={`${key}-value`} className='game-info-value'>
          {this.renderValue(mod[key], mod[key] || 'string')}
        </div>
      ),
    ];
  }

  private renderValue = (value: any, type: string) => {
    const { language } = this.props;
    if (type === 'date') {
      return new Date(value).toLocaleString(language);
    } else if (type === 'url') {
      return <a onClick={this.openUrl} href={value} >{value}</a>;
    } else if (type === 'bytes') {
      return util.bytesToString(value);
    } else {
      return value;
    }
  }

  private openUrl = (evt: React.MouseEvent<any>) => {
    evt.preventDefault();
    util.opn(evt.currentTarget.href).catch(err => undefined);
  }
}

function mapStateToProps(state: any, ownProps: IBaseProps): IConnectedProps {
  return {
    activeGameId: selectors.activeGameId(state),
    language: state.settings.interface.language,
  };
}

export default connect(mapStateToProps)(ModInfoPopover);
