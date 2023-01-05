import { IWorkshopMod } from '../types/interface';

import { TFunction } from 'i18next';
import * as React from 'react';

import { Icon, OverlayTrigger, tooltip, util } from 'vortex-api';
import { Button, Panel, Popover } from 'react-bootstrap';

const FILE_DETAILS_URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=';

export interface IBaseProps {
  mod: IWorkshopMod;
  t: TFunction;
  key: string;
  fallbackImg: string;
  onModClick: (mod: IWorkshopMod) => void;
}

interface IMenuIcon {
  t: TFunction;
  mod: IWorkshopMod;
}

function getWindowBounds(): DOMRect {
  const res = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    height: window.innerHeight,
    width: window.innerWidth,
    bottom: window.innerHeight,
    right: window.innerWidth,
  };

  return {
    ...res,
    toJSON: () => JSON.stringify(res),
  };
}

function MenuIcon(props: IMenuIcon) {
  const { t, mod } = props;
  const gameInfoPopover = (
    <Popover className='popover-workshop-info'>
      {util.bbcodeToReact(mod.short_description)}
    </Popover>
  );

  return (
    <OverlayTrigger
      key='info-overlay'
      overlay={gameInfoPopover}
      getBounds={getWindowBounds}
      orientation='horizontal'
      shouldUpdatePosition={true}
      trigger='click'
      rootClose={true}
    >
      <tooltip.IconButton
        icon='game-menu'
        className='game-thumbnail-info btn-embed'
        tooltip={t('Show Details')}
      />
    </OverlayTrigger>
  );
}

export default function ModThumbnail(props: IBaseProps) {
  const { t, mod, fallbackImg, onModClick } = props;
  const imgUrl = !!mod.preview_url ? mod.preview_url : fallbackImg;
  const onClick = React.useCallback(() => {
    onModClick(mod);
  }, [onModClick, mod]);

  const openDetails = React.useCallback(() => {
    util.opn(FILE_DETAILS_URL + mod.publishedfileid).catch(() => null);
  }, [mod]);

  const totalVotes = mod.vote_data.votes_up + mod.vote_data.votes_down;

  return (
    <Panel className='mod-thumbnail'>
      <Panel.Body className='mod-thumbnail-body'>
        <img
          onClick={onClick}
          className='thumbnail-img'
          style={{ backgroundImage: `url(${imgUrl})` }}
        />
        <div className='bottom'>
          <div className='name'>{mod.title}</div>
        </div>
        {totalVotes > 10 ? (
          <div className='workshop-rating'>
            <Icon name='endorse-yes'/>
            {Math.round(mod.vote_data.score * 100)}%
          </div>
         ) : null}
        <div className='hover-menu'>
          <div className='hover-content'>
            <MenuIcon t={t} mod={mod} />
            <div className='flex-center-both'>
              <Button onClick={onClick}>{t('Install')}</Button>
              <Button onClick={openDetails}>{t('Open Page')}</Button>
            </div>
          </div>
        </div>
      </Panel.Body>
    </Panel>
  );
}
