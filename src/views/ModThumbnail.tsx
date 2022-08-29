import { IWorkshopMod } from '../types/interface';

import { TFunction } from 'i18next';
import * as React from 'react';

import { log } from 'vortex-api';

export interface IBaseProps {
  mod: IWorkshopMod;
  t: TFunction;
  key: string;
  fallbackImg: string;
  onModClick: (mod: IWorkshopMod) => void;
}

export default function ModThumbnail(props: IBaseProps) {
  const { mod, fallbackImg, onModClick } = props;
  const imgUrl = !!mod.preview_url ? mod.preview_url : fallbackImg;
  const [img, setImg] = React.useState(fallbackImg);
  const onClick = React.useCallback(() => {
    onModClick(mod);
  }, [onModClick, mod]);

  React.useEffect(() => {
    // One time deal
    const fetchImage = async () => {
      if (imgUrl !== fallbackImg) {
        const options = {
          method: 'GET',
        }
        try {
          const res = await fetch(imgUrl, options).catch(err => Promise.reject(err));
          if (res.status === 200) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            setImg(url);
          }
        } catch (err) {
          // nop
          log('debug', 'Failed to fetch image', err);
        }
      }
    };
    fetchImage();
  }, []);

  return (
    <div className='mod-thumbnail-body'>
      <img
        onClick={onClick}
        className={'thumbnail-img'}
        src={img}
      />
      <div className='name'>
        {mod.title}
      </div>
    </div>
  );
}
