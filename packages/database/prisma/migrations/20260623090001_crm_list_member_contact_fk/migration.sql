-- AddForeignKey: crm_list_members.contactId → crm_contacts.id
ALTER TABLE "crm_list_members" ADD CONSTRAINT "crm_list_members_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
