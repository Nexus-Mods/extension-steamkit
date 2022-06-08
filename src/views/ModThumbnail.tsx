import { connect } from 'react-redux';
import { ComponentEx, Icon, IconBar, OverlayTrigger, tooltip, types, util } from 'vortex-api';

import ModInfoPopover from './ModInfoPopover';

import { IWorkshopMod } from '../types/interface';

import { TFunction } from 'i18next';
import * as React from 'react';

export interface IBaseProps {
  mod: IWorkshopMod;
  t: TFunction;
  key: string;
  fallbackImg: string;
  onModClick: (mod: IWorkshopMod) => void;
}

interface IConnectedProps {
}

type IProps = IBaseProps & IConnectedProps;

function nop() {
  // nop
}

class ModThumbnail extends ComponentEx<IProps, {}> {
  private mRef = null;

  public render(): JSX.Element {
    const imgUrl = !!this.props.mod.preview_url
      ? this.props.mod.preview_url
      : this.props.fallbackImg;
    return (
      <div className='mod-thumbnail-body'>
        <img
          onClick={this.onClick}
          className={'thumbnail-img'}
          src={imgUrl}
        />
        <div className='name'>
          {this.props.mod.title}
        </div>
      </div>
    );
  }

  private onClick = () => {
    this.props.onModClick(this.props.mod);
  }

  // private renderMenu(): JSX.Element[] {
  //   const { t, mod } = this.props;
  //   const gameInfoPopover = (
  //     <Popover id={`popover-info-${mod.publisherfileid}`} className='popover-mod-info' >
  //       <Provider store={this.context.api.store}>
  //         <IconBar
  //           id={`game-thumbnail-${mod.publisherfileid}`}
  //           className='buttons'
  //           instanceId={mod.publisherfileid}
  //           staticElements={[]}
  //           collapse={false}
  //           buttonType='text'
  //           orientation='vertical'
  //           t={t}
  //         />
  //         <ModInfoPopover
  //           t={t}
  //           mod={this.props.mod}
  //           onGameChange={nopAsync as any}
  //           onRefreshModInfo={nopAsync as any}
  //         />
  //       </Provider>
  //     </Popover>
  //   );

  //   return [(
  //     <div key='primary-buttons' className='hover-content'>
  //       <IconBar
  //         id={`game-thumbnail-${mod.publisherfileid}`}
  //         className='buttons'
  //         group={`steam-mod-buttons`}
  //         instanceId={mod.publisherfileid}
  //         staticElements={[]}
  //         collapse={false}
  //         buttonType='text'
  //         orientation='vertical'
  //         clickAnywhere={true}
  //         t={t}
  //       />
  //     </div>
  //   ), (
  //     <OverlayTrigger
  //       key='info-overlay'
  //       overlay={gameInfoPopover}
  //       triggerRef={this.setRef}
  //       getBounds={this.getWindowBounds}
  //       orientation='horizontal'
  //       shouldUpdatePosition={true}
  //       trigger='click'
  //       rootClose={true}
  //     >
  //       <tooltip.IconButton
  //         id={`btn-info-${this.props.mod.publisherfileid}`}
  //         icon='mod-menu'
  //         className='mod-thumbnail-info btn-embed'
  //         tooltip={t('Show Details')}
  //       />
  //     </OverlayTrigger>
  //   )];
  // }

  private getWindowBounds = (): DOMRect => {
    return {
      top: 0,
      left: 0,
      height: window.innerHeight,
      width: window.innerWidth,
      bottom: window.innerHeight,
      right: window.innerWidth,
    } as any;
  }

  private setRef = ref => {
    this.mRef = ref;
  }

  private redraw = () => {
    if (this.mRef !== null) {
      this.mRef.hide();
      setTimeout(() => {
        if (this.mRef !== null) {
          this.mRef.show();
        }
      }, 100);
    }
  }
}

const emptyObj = {};

function mapStateToProps(state: any, ownProps: IBaseProps): IConnectedProps {
  return {
  };
}

export default
  connect(mapStateToProps)(ModThumbnail);
