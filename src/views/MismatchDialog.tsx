import * as React from 'react';
import { connect } from 'react-redux';
import { ComponentEx, Modal, selectors, util } from 'vortex-api';

import { IMismatch } from '../types/interface';

import { setMismatchState } from '../actions/session';

import { withTranslation } from 'react-i18next';

import { Button, Checkbox } from 'react-bootstrap';

interface IBaseProps {
  onSelect: (mismatches: IMismatch[]) => void;
  onCancel: () => void;
}

interface IConnectedProps {
  gameMode: string;
  mismatches: IMismatch[];
}

interface IActionProps {
  onSetMismatchState: (mismatches: IMismatch[]) => void;
}

interface IComponentState {
  selectAll: boolean;
}

type IProps = IBaseProps & IActionProps & IConnectedProps;

class MismatchDialog extends ComponentEx<IProps, IComponentState> {
  constructor(props: IProps) {
    super(props);
    this.initState({
      selectAll: true,
    });
  }

  public render(): JSX.Element {
    const { mismatches, onCancel, t } = this.props;
    const { selectAll } = this.state;
    return (
      <Modal
        className={'common-dialog-info'}
        show={mismatches?.length > 0}
        onHide={onCancel}
      >
        <Modal.Header>
          <Modal.Title>{t('Steam detected mismatched files')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {this.renderContent()}
          <Checkbox
            className='mismatch-checkbox'
            id={'mismatch-select-all'}
            checked={selectAll}
            onChange={this.onSelectAll}
          >
            {t('Select All')}
          </Checkbox>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={onCancel}>{t('Cancel')}</Button>
          <Button onClick={this.select}>{t('Download and Replace Game Files')}</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private select = () => {
    const { mismatches, onSelect } = this.props;
    onSelect(mismatches.filter(m => m.enabled));
  }

  private renderContent(): JSX.Element {
    const { mismatches, t } = this.props;
    return (
      <div className='mismatch-dialog-container'>
        <div key='dialog-content-text' className='dialog-content-text'>
          {t('Steam file integrity verification has detected that the following original '
          + 'games files have either been altered or are missing. Please select the '
          + 'files you would like to restore:')}
        </div>
        <div key='mismatch-dialog-content-checkboxes' className='mismatch-dialog-content-choices'>
          <div>
            {mismatches.map(this.renderCheckbox)}
          </div>
        </div>
      </div>
    );
  }

  private renderCheckbox = (mismatch: IMismatch) => {
    return (
      <Checkbox
        className='mismatch-checkbox'
        id={mismatch.id}
        key={mismatch.id}
        checked={mismatch.enabled}
        onChange={this.toggleCheckbox}
      >
        {mismatch.filePath}
      </Checkbox>
    );
  }

  private toggleCheckbox = (evt: React.MouseEvent<any>) => {
    const { mismatches, onSetMismatchState } = this.props;
    const idx = mismatches.findIndex((m: IMismatch) => {
      return m.id === evt.currentTarget.id;
    });
    const newMismatches = mismatches.reduce((accum, iter, i) => {
      if (idx === i) {
        accum.push(({
          ...iter,
          enabled: !iter.enabled,
        }));
      } else {
        accum.push(iter);
      }
      return accum;
    }, []);
    onSetMismatchState(newMismatches);
  }

  private onSelectAll = () => {
    const { mismatches, onSetMismatchState } = this.props;
    const { selectAll } = this.state;
    const value = !selectAll;
    this.nextState.selectAll = value;
    const newMismatches = mismatches.reduce((accum, iter) => {
      accum.push(({
        ...iter,
        enabled: value,
      }));
      return accum;
    }, []);
    onSetMismatchState(newMismatches);
  }
}

function mapStateToProps(state: any): IConnectedProps {
  return {
    gameMode: selectors.activeGameId(state),
    mismatches: util.getSafe(state, ['session', 'steamkit', 'mismatches'], []),
  };
}

function mapDispatchToProps(dispatch: any): IActionProps {
  return {
    onSetMismatchState: (mismatches: IMismatch[]) =>
      dispatch(setMismatchState({ mismatches })),
  };
}

export default
  connect(mapStateToProps, mapDispatchToProps)(
    withTranslation(['steamkit'])(
      MismatchDialog as any)) as any;
