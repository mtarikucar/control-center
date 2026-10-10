import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../net/api.ts';
import { CodexRequestCard } from './CodexRequestCard.tsx';

vi.mock('../net/api.ts', () => ({api:{codexRequests:vi.fn(),answerCodexRequest:vi.fn()}}));
beforeEach(() => vi.mocked(api.answerCodexRequest).mockResolvedValue({ok:true}));
afterEach(() => {cleanup();vi.resetAllMocks();});
function show(method: string, params: Record<string,unknown>) {
  vi.mocked(api.codexRequests).mockResolvedValue([{id:'request',method,params}]);
  render(<CodexRequestCard employeeId="employee" requestId="request" />);
}
it('submits a required connector form only after an explicit owner answer', async () => {
  show('mcpServer/elicitation/request',{mode:'form',serverName:'Drive',message:'Choose a name',requestedSchema:{properties:{name:{type:'string',title:'Name'}},required:['name']}});
  const field = await screen.findByLabelText('Name');
  expect(api.answerCodexRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Onayla'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.change(field,{target:{value:'Report'}}); fireEvent.click(screen.getByText('Onayla'));
  await waitFor(() => expect(api.answerCodexRequest).toHaveBeenCalledWith('employee','request','accept',{name:'Report'}));
  expect(await screen.findByText('Codex isteği kapandı.')).toBeTruthy();
});
it('lets the owner decline even with invalid structured input', async () => {
  show('mcpServer/elicitation/request',{mode:'form',requestedSchema:{properties:{items:{type:'array'}}}});
  fireEvent.change(await screen.findByLabelText('items'),{target:{value:'not json'}});
  fireEvent.click(screen.getByText('Reddet'));
  await waitFor(() => expect(api.answerCodexRequest).toHaveBeenCalledWith('employee','request','decline',{}));
});
it('answers native questions with the correct per-question shape and masks secret inputs', async () => {
  show('item/tool/requestUserInput',{questions:[{id:'q',question:'Answer?',isSecret:true}]});
  const field = await screen.findByLabelText('Answer?');
  expect(field.getAttribute('type')).toBe('password');
  fireEvent.change(field,{target:{value:'example'}}); fireEvent.click(screen.getByText('Yanıtla'));
  await waitFor(() => expect(api.answerCodexRequest).toHaveBeenCalledWith('employee','request','accept',{q:{answers:['example']}}));
});
it('does not make an unsafe authentication URL clickable', async () => {
  show('mcpServer/elicitation/request',{mode:'url',url:'javascript:alert(1)'});
  await screen.findByText('Bağlantı adresi desteklenmiyor.');
  expect(screen.queryByRole('link')).toBeNull();
  expect((screen.getByText('Tamamladım') as HTMLButtonElement).disabled).toBe(true);
});
