import { getTimelineMilestones } from './seller.service';
import type { TimelineInput } from './seller.types';

const emptyInput: TimelineInput = {
  sellerCddRecord: null,
  eaa: null,
  property: null,
  firstViewingAt: null,
  acceptedOffer: null,
  counterpartyCddRecord: null,
  isCoBroke: false,
  otp: null,
  transaction: null,
};

describe('getTimelineMilestones', () => {
  describe('agent role — 11 milestones', () => {
    it('returns 11 milestones for agent role', () => {
      const milestones = getTimelineMilestones(emptyInput, 'agent');
      expect(milestones).toHaveLength(11);
    });

    it('all milestones are upcoming when no data', () => {
      const milestones = getTimelineMilestones(emptyInput, 'agent');
      expect(milestones[0].status).toBe('current'); // first non-completed is current
      expect(milestones.slice(1).every((m) => m.status === 'upcoming')).toBe(true);
    });

    it('marks seller CDD as completed with date when record exists', () => {
      const date = new Date('2026-01-10');
      const milestones = getTimelineMilestones(
        { ...emptyInput, sellerCddRecord: { createdAt: date } },
        'agent',
      );
      expect(milestones[0].label).toBe('Seller CDD Done');
      expect(milestones[0].status).toBe('completed');
      expect(milestones[0].date).toEqual(date);
    });

    it('marks EAA signed with videoCallConfirmedAt date', () => {
      const date = new Date('2026-01-12');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          sellerCddRecord: { createdAt: new Date() },
          eaa: { videoCallConfirmedAt: date, signedCopyPath: '/uploads/eaa.pdf' },
        },
        'agent',
      );
      expect(milestones[1].label).toBe('Estate Agency Agreement Signed');
      expect(milestones[1].status).toBe('completed');
      expect(milestones[1].date).toEqual(date);
    });

    it('marks Viewings current while listed, completed when property reaches offer_received', () => {
      const listedInput = {
        ...emptyInput,
        sellerCddRecord: { createdAt: new Date() },
        eaa: { videoCallConfirmedAt: new Date(), signedCopyPath: '/eaa.pdf' },
        property: { status: 'listed' as any, listedAt: new Date() },
      };
      const milestonesListed = getTimelineMilestones(listedInput, 'agent');
      const viewings = milestonesListed.find((m) => m.label === 'Viewings')!;
      expect(viewings.status).toBe('current');

      const offerInput = {
        ...listedInput,
        property: { status: 'offer_received' as any, listedAt: new Date() },
      };
      const milestonesOffer = getTimelineMilestones(offerInput, 'agent');
      const viewingsOffer = milestonesOffer.find((m) => m.label === 'Viewings')!;
      expect(viewingsOffer.status).toBe('completed');
    });

    it('marks counterparty CDD as not_applicable when isCoBroke', () => {
      const milestones = getTimelineMilestones(
        { ...emptyInput, isCoBroke: true },
        'agent',
      );
      const cdd = milestones.find((m) => m.label === 'Counterparty CDD')!;
      expect(cdd.notApplicable).toBe(true);
      expect(cdd.status).toBe('upcoming'); // N/A milestones are never 'current'
    });

    it('does not make counterparty CDD the current milestone when N/A', () => {
      // When isCoBroke, the milestone after counterparty CDD (OTP Review) should be current
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          sellerCddRecord: { createdAt: new Date() },
          eaa: { videoCallConfirmedAt: new Date(), signedCopyPath: '/eaa.pdf' },
          property: { status: 'listed' as any, listedAt: new Date() },
          acceptedOffer: { createdAt: new Date() },
          isCoBroke: true,
        },
        'agent',
      );
      const cdd = milestones.find((m) => m.label === 'Counterparty CDD')!;
      const otpReview = milestones.find((m) => m.label === 'OTP Review')!;
      expect(cdd.notApplicable).toBe(true);
      expect(otpReview.status).toBe('current');
    });

    it('populates OTP milestones with correct dates', () => {
      const reviewed = new Date('2026-02-01');
      const issued = new Date('2026-02-02');
      const exercised = new Date('2026-02-10');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'exercised' as any, agentReviewedAt: reviewed, issuedAt: issued, exercisedAt: exercised },
        },
        'agent',
      );
      const otpReview = milestones.find((m) => m.label === 'OTP Review')!;
      const otpIssued = milestones.find((m) => m.label === 'OTP Issued')!;
      const otpExercised = milestones.find((m) => m.label === 'OTP Exercised')!;
      expect(otpReview.status).toBe('completed');
      expect(otpReview.date).toEqual(reviewed);
      expect(otpIssued.status).toBe('completed');
      expect(otpIssued.date).toEqual(issued);
      expect(otpExercised.status).toBe('completed');
      expect(otpExercised.date).toEqual(exercised);
    });

    it('marks HDB Resale Submission completed when status is not not_started', () => {
      const submitted = new Date('2026-02-20');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          transaction: {
            status: 'option_exercised' as any,
            hdbApplicationStatus: 'application_submitted' as any,
            hdbAppSubmittedAt: submitted,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'agent',
      );
      const hdb = milestones.find((m) => m.label === 'HDB Resale Submission')!;
      expect(hdb.status).toBe('completed');
      expect(hdb.date).toEqual(submitted);
    });

    it('marks Completion completed with completionDate', () => {
      const completionDate = new Date('2026-03-15');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          transaction: {
            status: 'completed' as any,
            hdbApplicationStatus: 'completed' as any,
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate,
          },
        },
        'agent',
      );
      const completion = milestones.find((m) => m.label === 'Completion')!;
      expect(completion.status).toBe('completed');
      expect(completion.date).toEqual(completionDate);
    });
  });

  describe('admin role', () => {
    it('returns 19 milestones for admin role when otp and transaction exist', () => {
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'prepared' as any, agentReviewedAt: null, issuedAt: null, exercisedAt: null },
          transaction: {
            status: 'option_issued' as any,
            hdbApplicationStatus: 'not_started' as any,
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'admin',
      );
      expect(milestones).toHaveLength(19);
    });

    it('returns 11 milestones for admin when no otp and no transaction', () => {
      const milestones = getTimelineMilestones(emptyInput, 'admin');
      expect(milestones).toHaveLength(11);
    });

    it('OTP sub-steps are completed based on OTP status order', () => {
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          otp: { status: 'returned' as any, agentReviewedAt: null, issuedAt: null, exercisedAt: null },
          transaction: {
            status: 'option_issued' as any,
            hdbApplicationStatus: 'not_started' as any,
            hdbAppSubmittedAt: null,
            hdbAppApprovedAt: null,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'admin',
      );
      const prepared = milestones.find((m) => m.label === 'OTP Prepared')!;
      const sentToSeller = milestones.find((m) => m.label === 'OTP Sent to Seller')!;
      const signedBySeller = milestones.find((m) => m.label === 'OTP Signed by Seller')!;
      const returnedToAgent = milestones.find((m) => m.label === 'OTP Returned to Agent')!;
      expect(prepared.status).toBe('completed');
      expect(sentToSeller.status).toBe('completed');
      expect(signedBySeller.status).toBe('completed');
      // 'OTP Returned to Agent' is completed when status >= 'issued_to_buyer'.
      // With status='returned', that condition is false → it becomes 'current' (first incomplete milestone).
      expect(returnedToAgent.status).toBe('current');
    });

    it('HDB sub-steps are completed based on HDB status order', () => {
      const approved = new Date('2026-03-01');
      const milestones = getTimelineMilestones(
        {
          ...emptyInput,
          counterpartyCddRecord: { createdAt: new Date() },
          otp: { status: 'exercised' as any, agentReviewedAt: new Date(), issuedAt: new Date(), exercisedAt: new Date() },
          transaction: {
            status: 'completing' as any,
            hdbApplicationStatus: 'approval_granted' as any,
            hdbAppSubmittedAt: new Date(),
            hdbAppApprovedAt: approved,
            hdbAppointmentDate: null,
            completionDate: null,
          },
        },
        'admin',
      );
      const aip = milestones.find((m) => m.label === 'HDB Approval in Principle')!;
      const ag = milestones.find((m) => m.label === 'HDB Approval Granted')!;
      const rc = milestones.find((m) => m.label === 'Resale Checklist Submitted')!;
      const appt = milestones.find((m) => m.label === 'HDB Appointment Booked')!;
      expect(aip.status).toBe('completed');
      expect(ag.status).toBe('completed');
      expect(ag.date).toEqual(approved);
      expect(rc.status).toBe('current');
      expect(appt.status).toBe('upcoming');
    });
  });
});
